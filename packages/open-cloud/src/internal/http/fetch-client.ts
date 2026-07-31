import { ApiError } from "../../errors/api-error.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import type { Result } from "../../types.ts";
import { tryCatch } from "../utils/try-catch.ts";
import { extractGatewaySummary, pickDiagnosticHeaders } from "./diagnostics.ts";
import { createHttp1Dispatcher } from "./http1-dispatcher.ts";
import { reduceRateLimitTokens } from "./rate-limit-sample.ts";
import type { HttpClient, HttpRequest, HttpResponse, RequestConfig } from "./types.ts";
import { isUploadRequest } from "./upload-request.ts";

// Caps the raw body retained when a response cannot be parsed, so a multi-KB
// HTML error page is not surfaced or logged whole.
const MAX_DETAIL_LENGTH = 500;

const CONTENT_TYPE_HEADER = "content-type";

// Uploads opt out of keep-alive reuse. Roblox's edge gateway discards idle
// pooled connections faster than a pooling `fetch` expects, and a request
// written into a discarded connection never reaches Open Cloud: it surfaces as
// a gateway error page or a socket reset, minutes later, having done nothing.
// An upload holds a connection far longer than a JSON call, so it is the shape
// that loses this race. The cost is a fresh handshake and a cold congestion
// window per upload (real for a multi-megabyte body, and paid again on each
// retry), but cheaper than a lost write. Small, frequent calls keep pooling.
const CONNECTION_HEADER = "connection";

/**
 * `RequestInit` plus undici's non-standard `dispatcher`, the only way to
 * select a transport from `fetch`. Declared locally because it is absent from
 * the DOM lib and runtimes that do not understand it ignore it.
 */
interface FetchOptions extends RequestInit {
	dispatcher?: object | undefined;
}

/**
 * Collaborators of {@link createFetchHttpClient}, bundled so the factory keeps
 * a two-argument signature as they accumulate. Both have production defaults;
 * both are overridable, which is also what makes them testable.
 */
interface FetchHttpClientSeams {
	/**
	 * Builds the HTTP/1.1-only transport uploads use, so the
	 * `connection: close` directive is not dropped by an h2 transport.
	 */
	readonly createDispatcher?: () => object | undefined;
	/** Monotonic-ish clock used to measure request elapsed time. */
	readonly now?: () => number;
}

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

interface ErrorResponseArgs {
	readonly context: RequestContext;
	readonly parsed: Result<JSONValue | undefined>;
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
export function buildFetchOptions(request: HttpRequest, config: RequestConfig): FetchOptions {
	const headers = new Headers({
		"x-api-key": config.apiKey,
	});

	const options: FetchOptions = {
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

	applyRequestHeaders(headers, request);

	if (config.timeout !== undefined) {
		options.signal = AbortSignal.timeout(config.timeout);
	}

	return options;
}

/**
 * Creates an {@link HttpClient} backed by the Fetch API.
 *
 * @param fetchFunc - The fetch implementation to use. Defaults to `globalThis.fetch`.
 * @param seams - Injectable clock and dispatcher factory, so tests need not
 *   depend on wall-clock time or on the runtime's global dispatcher.
 * @returns An HttpClient that classifies responses into typed Results.
 */
export function createFetchHttpClient(
	fetchFunc: (url: string, init: RequestInit) => Promise<Response> = globalThis.fetch,
	seams: FetchHttpClientSeams = {},
): HttpClient {
	const { createDispatcher = createHttp1Dispatcher, now = Date.now } = seams;
	const dispatcherFor = createUploadDispatcherCache(createDispatcher);

	return {
		async request(
			httpRequest: HttpRequest,
			config: RequestConfig,
		): Promise<Result<HttpResponse, OpenCloudError>> {
			const url = buildUrl(httpRequest, config);
			const options = buildFetchOptions(httpRequest, config);
			// Undefined is how `fetch` spells "use the runtime's own
			// transport", so this is safe to assign unconditionally.
			options.dispatcher = dispatcherFor(httpRequest);
			const target = { method: httpRequest.method, url };

			const { elapsedMs, fetchResult } = await timedFetch(now, async () =>
				fetchFunc(url, options),
			);
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

/**
 * Merges the request's own headers onto the transport's, then applies the
 * transport-owned connection directive. `x-api-key` is skipped so a request
 * cannot override the configured credential, and the upload directive is set
 * last so a request header cannot silently re-enable pooling for an upload.
 *
 * @param headers - The headers being built for the fetch call. Mutated.
 * @param request - The request whose headers and body shape drive the merge.
 */
function applyRequestHeaders(headers: Headers, request: HttpRequest): void {
	const requestHeaders = request.headers ?? {};
	for (const [name, value] of Object.entries(requestHeaders)) {
		if (name.toLowerCase() === "x-api-key") {
			continue;
		}

		headers.set(name, value);
	}

	if (isUploadRequest(request)) {
		headers.set(CONNECTION_HEADER, "close");
	}
}

/**
 * Wraps a dispatcher factory in the caching policy uploads need.
 *
 * Resolution happens on the first upload rather than at construction: undici
 * publishes its global dispatcher lazily, so before a process's first `fetch`
 * there is nothing to read. A resolved dispatcher is kept, and an unresolved
 * one is retried on the next upload — so a runtime that publishes late is
 * still picked up, and the first request of a process, which has no pooled
 * connection to lose, is safe either way.
 *
 * @param createDispatcher - Builds the HTTP/1.1-only transport.
 * @returns A function yielding the dispatcher for a request, or `undefined`
 *   when the request is not an upload or no dispatcher is available.
 */
function createUploadDispatcherCache(
	createDispatcher: () => object | undefined,
): (request: HttpRequest) => object | undefined {
	let cached: object | undefined;
	return (request) => {
		if (!isUploadRequest(request)) {
			return;
		}

		cached ??= createDispatcher();
		return cached;
	};
}

/**
 * Runs `send` and reports both its Result and how long it was in flight,
 * measured with `now`. Isolated so the timing start need not sit in the request
 * body ahead of the transport-failure early return.
 *
 * @param now - The clock used to bound the call.
 * @param send - A thunk that issues the fetch.
 * @returns The fetch Result and the elapsed milliseconds.
 */
async function timedFetch(
	now: () => number,
	send: () => Promise<Response>,
): Promise<{ elapsedMs: number; fetchResult: Result<Response> }> {
	const start = now();
	const fetchResult = await tryCatch(send());
	// Clamp to zero: `Date.now` is wall-clock, so an NTP adjustment mid-request
	// could otherwise report a negative "after -0.1s".
	return { elapsedMs: Math.max(0, now() - start), fetchResult };
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

function createApiError(args: ErrorResponseArgs): ApiError {
	const { context, rawText, response } = args;
	const { status } = response;
	const headers = headersToRecord(response.headers);
	const requestContext = {
		elapsedMs: context.elapsedMs,
		method: context.method,
		responseHeaders: pickDiagnosticHeaders(headers),
		statusCode: status,
		url: context.url,
	};

	// An HTML body is a load-balancer error page, not an Open Cloud response;
	// summarize it rather than retaining the raw HTML on `details`.
	const gatewaySummary = extractGatewaySummary(headers[CONTENT_TYPE_HEADER], rawText);
	if (gatewaySummary !== undefined) {
		return new ApiError(`HTTP ${status}`, { ...requestContext, gatewaySummary });
	}

	const body = bodyDetail(rawText, args.parsed);
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
			err: createApiError({ context, parsed, rawText: text, response }),
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
