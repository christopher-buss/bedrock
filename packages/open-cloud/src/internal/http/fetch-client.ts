import { ApiError } from "../../errors/api-error.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import type { Result } from "../../types.ts";
import { tryCatch } from "../utils/try-catch.ts";
import type { HttpClient, HttpRequest, HttpResponse, RequestConfig } from "./types.ts";

// Caps the raw body retained when a response cannot be parsed, so a multi-KB
// HTML error page is not surfaced or logged whole.
const MAX_DETAIL_LENGTH = 500;

const CONTENT_TYPE_HEADER = "content-type";

interface ParseFailureArgs {
	readonly cause: Error;
	readonly response: Response;
	readonly text: string;
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
 * Parses the `x-ratelimit-reset` header value into seconds.
 *
 * @param headerValue - The raw header value, or `undefined` if missing.
 * @returns The number of seconds to wait, or 0 if missing/invalid.
 */
export function parseRetryAfterSeconds(headerValue: string | undefined): number {
	const parsed = Number(headerValue);
	if (Number.isNaN(parsed)) {
		return 0;
	}

	return Math.max(0, Math.floor(parsed));
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
): HttpClient {
	return {
		async request(
			httpRequest: HttpRequest,
			config: RequestConfig,
		): Promise<Result<HttpResponse, OpenCloudError>> {
			const url = buildUrl(httpRequest, config);
			const options = buildFetchOptions(httpRequest, config);

			const fetchResult = await tryCatch(fetchFunc(url, options));
			if (!fetchResult.success) {
				return {
					err: new NetworkError("Network request failed", { cause: fetchResult.err }),
					success: false,
				};
			}

			return classifyResponse(fetchResult.data);
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

function createApiError(status: number, body: JSONValue | undefined): ApiError {
	const code = extractErrorCode(body);
	const message = extractErrorMessage(body);
	return new ApiError(formatApiErrorMessage({ code, message, status }), {
		code,
		details: body,
		statusCode: status,
	});
}

function createRateLimitError(response: Response): RateLimitError {
	return new RateLimitError("Rate limited", {
		retryAfterSeconds: parseRetryAfterSeconds(
			response.headers.get("x-ratelimit-reset") ?? undefined,
		),
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
 * never require valid JSON: an error body that is not valid JSON (for example
 * an HTML gateway page) degrades to a status-based {@link ApiError} carrying
 * the raw text. A parse failure is only fatal on a 2xx, where a parseable body is part
 * of the contract.
 *
 * @param response - The raw fetch Response to classify.
 * @returns A Result containing an HttpResponse on success or an OpenCloudError on failure.
 */
async function classifyResponse(response: Response): Promise<Result<HttpResponse, OpenCloudError>> {
	if (response.status === 429) {
		return { err: createRateLimitError(response), success: false };
	}

	const text = await response.text();
	const parsed: Result<JSONValue | undefined> =
		text === "" ? { data: undefined, success: true } : parseJson(text);

	if (response.status >= 300) {
		const body = parsed.success ? parsed.data : text.slice(0, MAX_DETAIL_LENGTH);
		return { err: createApiError(response.status, body), success: false };
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
