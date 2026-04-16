import type { HttpRequest, RequestConfig } from "./types.ts";

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
 * Permissively extracts a top-level `errorCode` string field from a
 * response body.
 *
 * @param body - The parsed response body (unknown shape).
 * @returns The `errorCode` string if present, otherwise `undefined`.
 */
export function extractErrorCode(body: unknown): string | undefined {
	if (typeof body !== "object" || body === null) {
		return undefined;
	}

	if (!("errorCode" in body)) {
		return undefined;
	}

	const { errorCode } = body as { errorCode: unknown };
	return typeof errorCode === "string" ? errorCode : undefined;
}

/**
 * Parses the `x-ratelimit-reset` header value into seconds.
 *
 * @param headerValue - The raw header value, or `undefined` if missing.
 * @returns The number of seconds to wait, or 0 if missing/invalid.
 */
export function parseRetryAfterSeconds(headerValue: string | undefined): number {
	if (headerValue === undefined) {
		return 0;
	}

	const parsed = Number(headerValue);
	if (Number.isNaN(parsed) || parsed < 0) {
		return 0;
	}

	return Math.floor(parsed);
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
	} else if (request.body !== undefined) {
		headers.set("content-type", "application/json");
		options.body = JSON.stringify(request.body);
	}

	if (config.timeout !== undefined) {
		options.signal = AbortSignal.timeout(config.timeout);
	}

	return options;
}
