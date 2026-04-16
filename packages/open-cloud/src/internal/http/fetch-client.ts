import type { HttpRequest, RequestConfig } from "./types.ts";

/**
 * Converts a `Headers` object to a plain record with lowercased keys.
 *
 * @param _headers - The `Headers` instance to convert.
 * @returns A record mapping lowercased header names to their values.
 */
export function headersToRecord(_headers: Headers): Record<string, string> {
	return {};
}

/**
 * Permissively extracts a top-level `errorCode` string field from a
 * response body.
 *
 * @param _body - The parsed response body (unknown shape).
 * @returns The `errorCode` string if present, otherwise `undefined`.
 */
export function extractErrorCode(_body: unknown): string | undefined {
	return undefined;
}

/**
 * Parses the `x-ratelimit-reset` header value into seconds.
 *
 * @param _headerValue - The raw header value, or `undefined` if missing.
 * @returns The number of seconds to wait, or 0 if missing/invalid.
 */
export function parseRetryAfterSeconds(_headerValue: string | undefined): number {
	return -1;
}

/**
 * Joins the base URL from config with the relative path from the request.
 *
 * @param _request - The HTTP request containing the relative URL.
 * @param _config - The request config containing the base URL.
 * @returns The fully-qualified URL string.
 */
export function buildUrl(_request: HttpRequest, _config: RequestConfig): string {
	return "";
}

/**
 * Constructs the `RequestInit` options for a `fetch` call.
 *
 * @param _request - The HTTP request to build options for.
 * @param _config - The request config containing API key and timeout.
 * @returns A `RequestInit` object ready for `fetch`.
 */
export function buildFetchOptions(_request: HttpRequest, _config: RequestConfig): RequestInit {
	return {};
}
