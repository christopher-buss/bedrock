import { ApiError } from "../../errors/api-error.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import type { Result } from "../../types.ts";
import { tryCatch } from "../utils/try-catch.ts";
import { reduceRateLimitTokens } from "./rate-limit-sample.ts";
import type { HttpClient, HttpRequest, HttpResponse, RequestConfig } from "./types.ts";

// Caps the raw body retained when a response cannot be parsed, so a multi-KB
// HTML error page is not surfaced or logged whole.
const MAX_DETAIL_LENGTH = 500;

const CONTENT_TYPE_HEADER = "content-type";

// A small allowlist of response headers worth retaining on an ApiError for
// diagnosis and escalation to Roblox. apis.roblox.com returns `server` (e.g.
// `public-gateway`, or `haproxy` on a load-balancer error page) and
// `x-roblox-edge` on every response; `via`, `x-request-id`, and `cf-ray` are
// standard proxy/CDN request-id headers kept in case an edge adds them. The
// full header set is never retained, to avoid surfacing anything sensitive.
const DIAGNOSTIC_HEADER_ALLOWLIST: ReadonlySet<string> = new Set([
	"cf-ray",
	"server",
	"via",
	"x-request-id",
]);

const DIAGNOSTIC_HEADER_PREFIX = "x-roblox-";

interface ParseFailureArgs {
	readonly cause: Error;
	readonly response: Response;
	readonly text: string;
}

/**
 * The request-level context threaded from the transport into error
 * construction: which call failed and how long it was in flight.
 */
interface RequestContext {
	readonly elapsedMs: number;
	readonly method: string;
	readonly url: string;
}

interface CreateApiErrorArgs extends RequestContext {
	readonly body: JSONValue | undefined;
	readonly rawText: string;
	readonly response: Response;
}

interface ApiErrorMessageParts {
	readonly code: string | undefined;
	readonly message: string | undefined;
	readonly status: number;
}

/**
 * Converts a `Headers` object to a plain record with lowercased keys.
 *
 * @param headers - The `Headers` instance to convert.
 * @returns A record mapping lowercased header names to their values.
 */
export function headersToRecord(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers);
}

/**
 * Filters a lowercased header record down to the diagnostic allowlist: a few
 * named escalation headers plus any `x-roblox-*` header. Keeps errors light and
 * avoids retaining anything sensitive from the full response header set.
 *
 * @param headers - The full header record (lowercased keys).
 * @returns A record containing only the allowlisted headers that were present.
 */
export function pickDiagnosticHeaders(headers: Record<string, string>): Record<string, string> {
	const picked: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (DIAGNOSTIC_HEADER_ALLOWLIST.has(name) || name.startsWith(DIAGNOSTIC_HEADER_PREFIX)) {
			picked[name] = value;
		}
	}

	return picked;
}

const TITLE_PATTERN = /<title[^>]*>([\S\s]*?)<\/title>/i;
const H1_PATTERN = /<h1[^>]*>([\S\s]*?)<\/h1>/i;
const TAG_PATTERN = /<[^>]*>/g;
const WHITESPACE_PATTERN = /\s+/g;

function isHtmlBody(contentType: string | undefined, rawText: string): boolean {
	if (contentType !== undefined && contentType.toLowerCase().includes("text/html")) {
		return true;
	}

	const head = rawText.trimStart().toLowerCase();
	return head.startsWith("<html") || head.startsWith("<!doctype html");
}

function firstTagText(html: string, pattern: RegExp): string | undefined {
	const match = pattern.exec(html);
	if (!match) {
		return undefined;
	}

	const inner = match[1] ?? "";
	const text = inner.replace(TAG_PATTERN, " ").replace(WHITESPACE_PATTERN, " ").trim();
	return text === "" ? undefined : text;
}

/**
 * Extracts a one-line human summary from an HTML gateway error page, or returns
 * `undefined` when the body is not such a page. A load balancer (HAProxy-style)
 * rejects a request before it reaches Open Cloud and answers with an HTML page,
 * not a JSON Open Cloud error; dumping that HTML whole is noise. The body is
 * treated as HTML when the content-type is `text/html` or the trimmed body is
 * tag-led (`<html`/`<!doctype html`), and the summary is taken from the
 * `<title>` (falling back to the first `<h1>`), tags stripped and whitespace
 * collapsed.
 *
 * @param contentType - The response `content-type` header, if present.
 * @param rawText - The raw response body text.
 * @returns The extracted summary, or `undefined` when the body is not an HTML
 *   gateway page (or carries no title/h1 text).
 */
export function extractGatewaySummary(
	contentType: string | undefined,
	rawText: string,
): string | undefined {
	if (!isHtmlBody(contentType, rawText)) {
		return undefined;
	}

	return firstTagText(rawText, TITLE_PATTERN) ?? firstTagText(rawText, H1_PATTERN);
}

/**
 * Permissively extracts a machine-readable error code from a response body.
 *
 * Modern Open Cloud responses use `{ errorCode: string, message: string }`;
 * the legacy game-internationalization endpoints use
 * `{ errors: [{ code: number, message: string }, ...] }`. Both shapes are
 * checked; numeric legacy codes are returned as strings so callers see one
 * consistent type.
 *
 * @param body - The parsed response body (unknown shape).
 * @returns The error code if present, otherwise `undefined`.
 */
export function extractErrorCode(body: unknown): string | undefined {
	if (body === null || typeof body !== "object") {
		return undefined;
	}

	const errorCode = Reflect.get(body, "errorCode");
	if (typeof errorCode === "string") {
		return errorCode;
	}

	return extractLegacyCode(body);
}

/**
 * Permissively extracts a human-readable error message from a response body.
 *
 * Modern Open Cloud responses expose `message` at the top level; the legacy
 * game-internationalization endpoints nest it under `errors[0].message`.
 *
 * @param body - The parsed response body (unknown shape).
 * @returns The message if present, otherwise `undefined`.
 */
export function extractErrorMessage(body: unknown): string | undefined {
	if (body === null || typeof body !== "object") {
		return undefined;
	}

	const message = Reflect.get(body, "message");
	if (typeof message === "string") {
		return message;
	}

	return extractLegacyMessage(body);
}

/**
 * Parses the `x-ratelimit-reset` header value into seconds. On a 429 the header
 * is a comma-separated list of per-window reset times (e.g. `"22, 0"`, one entry
 * per rate-limit window); the largest value is the longest-resetting window and
 * the only safe wait that won't retry into a still-exhausted window. A single
 * value is treated as a one-element list.
 *
 * @param headerValue - The raw header value, or `undefined` if missing.
 * @returns The number of seconds to wait, or 0 if missing/invalid.
 */
export function parseRetryAfterSeconds(headerValue: string | undefined): number {
	return reduceRateLimitTokens(headerValue, (a, b) => Math.max(a, b)) ?? 0;
}

/**
 * Joins the base URL from config with the relative path from the request.
 *
 * @param request - The HTTP request containing the relative URL.
 * @param config - The request config containing the base URL.
 * @returns The fully-qualified URL string.
 */
export function buildUrl(request: HttpRequest, config: RequestConfig): string {
	const base = config.baseUrl.endsWith("/") ? config.baseUrl.slice(0, -1) : config.baseUrl;
	return `${base}${request.url}`;
}

/**
 * Constructs the `RequestInit` options for a `fetch` call.
 *
 * @param request - The HTTP request to build options for.
 * @param config - The request config containing API key and timeout.
 * @returns A `RequestInit` object ready for `fetch`.
 */
export function buildFetchOptions(request: HttpRequest, config: RequestConfig): RequestInit {
	const headers = new Headers({
		"x-api-key": config.apiKey,
	});

	const options: RequestInit = {
		headers,
		method: request.method,
	};

	if (request.body instanceof FormData) {
		options.body = request.body;
	} else if (request.body instanceof Uint8Array) {
		headers.set(CONTENT_TYPE_HEADER, "application/octet-stream");
		options.body = request.body;
	} else if (request.body !== undefined) {
		headers.set(CONTENT_TYPE_HEADER, "application/json");
		options.body = JSON.stringify(request.body);
	}

	if (request.headers !== undefined) {
		for (const [name, value] of Object.entries(request.headers)) {
			if (name.toLowerCase() === "x-api-key") {
				continue;
			}

			headers.set(name, value);
		}
	}

	if (config.timeout !== undefined) {
		options.signal = AbortSignal.timeout(config.timeout);
	}

	return options;
}

/**
 * Creates an {@link HttpClient} backed by the Fetch API.
 *
 * @param fetchFunc - The fetch implementation to use. Defaults to `globalThis.fetch`.
 * @returns An HttpClient that classifies responses into typed Results.
 */
export function createFetchHttpClient(
	fetchFunc: (url: string, init: RequestInit) => Promise<Response> = globalThis.fetch,
	now: () => number = Date.now,
): HttpClient {
	return {
		async request(
			httpRequest: HttpRequest,
			config: RequestConfig,
		): Promise<Result<HttpResponse, OpenCloudError>> {
			const url = buildUrl(httpRequest, config);
			const options = buildFetchOptions(httpRequest, config);

			const target = { method: httpRequest.method, url };

			const start = now();
			const fetchResult = await tryCatch(fetchFunc(url, options));
			const elapsedMs = now() - start;
			if (!fetchResult.success) {
				return { err: networkError(fetchResult.err, target), success: false };
			}

			// Reading and classifying the body can itself throw (an aborted or
			// undecodable body stream rejects `response.text()`); keep the
			// Result contract by mapping any such throw to a NetworkError.
			const context: RequestContext = { elapsedMs, method: target.method, url: target.url };
			const classified = await tryCatch(classifyResponse(fetchResult.data, context));
			if (!classified.success) {
				return { err: networkError(classified.err, target), success: false };
			}

			return classified.data;
		},
	};
}

function readLegacyErrorEntry(body: object): object | undefined {
	const errors = Reflect.get(body, "errors");
	if (!Array.isArray(errors)) {
		return undefined;
	}

	const [first] = errors;
	if (typeof first !== "object" || first === null) {
		return undefined;
	}

	return first;
}

function extractLegacyCode(body: object): string | undefined {
	const first = readLegacyErrorEntry(body);
	if (first === undefined) {
		return undefined;
	}

	const code = Reflect.get(first, "code");
	if (typeof code === "string") {
		return code;
	}

	return typeof code === "number" ? String(code) : undefined;
}

function extractLegacyMessage(body: object): string | undefined {
	const first = readLegacyErrorEntry(body);
	if (first === undefined) {
		return undefined;
	}

	const message = Reflect.get(first, "message");
	return typeof message === "string" ? message : undefined;
}

function networkError(cause: Error, target: { method: string; url: string }): NetworkError {
	return new NetworkError("Network request failed", {
		cause,
		method: target.method,
		url: target.url,
	});
}

function formatApiErrorMessage(parts: ApiErrorMessageParts): string {
	const { code, message, status } = parts;
	const base = `HTTP ${status}`;
	if (message === undefined && code === undefined) {
		return base;
	}

	if (message === undefined) {
		return `${base} (code ${code})`;
	}

	if (code === undefined) {
		return `${base}: ${message}`;
	}

	return `${base}: ${message} (code ${code})`;
}

function createApiError(args: CreateApiErrorArgs): ApiError {
	const { body, elapsedMs, method, rawText, response, url } = args;
	const status = response.status;
	const headers = headersToRecord(response.headers);
	const requestContext = {
		elapsedMs,
		method,
		responseHeaders: pickDiagnosticHeaders(headers),
		statusCode: status,
		url,
	};

	// An HTML body is a load-balancer error page, not an Open Cloud response;
	// summarize it rather than retaining the raw HTML on `details`.
	const gatewaySummary = extractGatewaySummary(headers[CONTENT_TYPE_HEADER], rawText);
	if (gatewaySummary !== undefined) {
		return new ApiError(`HTTP ${status}`, { ...requestContext, gatewaySummary });
	}

	const code = extractErrorCode(body);
	const message = extractErrorMessage(body);
	return new ApiError(formatApiErrorMessage({ code, message, status }), {
		...requestContext,
		code,
		details: body,
	});
}

/**
 * Parses response text as JSON, returning the underlying `SyntaxError` on
 * failure rather than throwing. The synchronous sibling of {@link tryCatch}.
 *
 * @param text - The raw response body text.
 * @returns A Result wrapping the parsed value, or the parse error.
 */
function parseJson(text: string): Result<JSONValue> {
	try {
		return { data: JSON.parse(text), success: true };
	} catch (err) {
		return { err: err instanceof Error ? err : new Error(String(err)), success: false };
	}
}

/**
 * Reads a response body once and parses it best-effort: an empty body is a
 * successful `undefined`, otherwise the JSON parse result (which carries the
 * `SyntaxError` on failure). Returns the raw `text` alongside so callers that
 * need the original bytes (parse-failure diagnostics) do not re-read the
 * consumed stream.
 *
 * @param response - The Response whose body to read.
 * @returns The parse result and the raw text.
 */
async function readResponseBody(
	response: Response,
): Promise<{ parsed: Result<JSONValue | undefined>; text: string }> {
	const text = await response.text();
	return {
		parsed: text === "" ? { data: undefined, success: true } : parseJson(text),
		text,
	};
}

/**
 * Projects a read body to the detail carried on an error: the parsed JSON when
 * it parsed, otherwise the raw text truncated to {@link MAX_DETAIL_LENGTH}.
 *
 * @param text - The raw response body text.
 * @param parsed - The best-effort parse result from {@link readResponseBody}.
 * @returns The parsed body, or the truncated raw text on a parse failure.
 */
function bodyDetail(text: string, parsed: Result<JSONValue | undefined>): JSONValue | undefined {
	return parsed.success ? parsed.data : text.slice(0, MAX_DETAIL_LENGTH);
}

async function createRateLimitError(response: Response): Promise<RateLimitError> {
	const headers = headersToRecord(response.headers);
	const { parsed, text } = await readResponseBody(response);
	return new RateLimitError("Rate limited", {
		details: bodyDetail(text, parsed),
		remaining: reduceRateLimitTokens(headers["x-ratelimit-remaining"], (a, b) =>
			Math.min(a, b),
		),
		retryAfterSeconds: parseRetryAfterSeconds(headers["x-ratelimit-reset"]),
		statusCode: response.status,
	});
}

/**
 * Builds the error for a 2xx response whose body could not be parsed as JSON,
 * preserving the parse `cause`, the (truncated) raw body, and the declared
 * content-type so the failure can be diagnosed after the fact.
 *
 * @param args - The Response, raw body text, and underlying parse error.
 * @returns An ApiError carrying the diagnostic context.
 */
function parseFailureError({ cause, response, text }: ParseFailureArgs): ApiError {
	const contentType = response.headers.get(CONTENT_TYPE_HEADER) ?? "unknown";
	return new ApiError(`Failed to parse response body (content-type: ${contentType})`, {
		cause,
		details: text.slice(0, MAX_DETAIL_LENGTH),
		statusCode: response.status,
	});
}

/**
 * Classifies a fetch `Response` into a typed `Result`.
 *
 * The body is read once and parsed best-effort. Error responses (status >= 300)
 * never require valid JSON: an error body that is not valid JSON degrades to a
 * status-based {@link ApiError} carrying the raw text, and an HTML gateway page
 * is summarized rather than dumped. A parse failure is only fatal on a 2xx,
 * where a parseable body is part of the contract.
 *
 * @param response - The raw fetch Response to classify.
 * @param context - The request context (method, url, elapsed time) threaded
 *   onto any {@link ApiError} built for an error response.
 * @returns A Result containing an HttpResponse on success or an OpenCloudError on failure.
 */
async function classifyResponse(
	response: Response,
	context: RequestContext,
): Promise<Result<HttpResponse, OpenCloudError>> {
	if (response.status === 429) {
		return { err: await createRateLimitError(response), success: false };
	}

	const { parsed, text } = await readResponseBody(response);

	if (response.status >= 300) {
		return {
			err: createApiError({
				...context,
				body: bodyDetail(text, parsed),
				rawText: text,
				response,
			}),
			success: false,
		};
	}

	if (!parsed.success) {
		return { err: parseFailureError({ cause: parsed.err, response, text }), success: false };
	}

	return {
		data: {
			body: parsed.data,
			headers: headersToRecord(response.headers),
			status: response.status,
		},
		success: true,
	};
}
