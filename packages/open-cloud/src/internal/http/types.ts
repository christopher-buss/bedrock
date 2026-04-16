import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";

/**
 * Supported request body types.
 *
 * - `FormData` for multipart uploads (Content-Type set automatically by fetch)
 * - `Record<string, unknown>` for JSON bodies (serialized with JSON.stringify)
 * - `undefined` for requests without a body (GET, DELETE).
 */
export type HttpRequestBody = FormData | Record<string, unknown> | undefined;

/**
 * A normalized HTTP request to send to the Roblox Open Cloud API.
 */
export interface HttpRequest {
	/** The request body. */
	readonly body?: HttpRequestBody;
	/** The HTTP method. */
	readonly method: "DELETE" | "GET" | "PATCH" | "POST";
	/** Relative path, e.g. "/game-passes/v1/universes/123/...". */
	readonly url: string;
}

/**
 * A normalized HTTP response from the Roblox Open Cloud API.
 */
export interface HttpResponse {
	/** The parsed response body. */
	readonly body: unknown;
	/** Response headers with lowercased keys. */
	readonly headers: Readonly<Record<string, string>>;
	/** The HTTP status code. */
	readonly status: number;
}

/**
 * Per-request configuration passed to {@link HttpClient.request}.
 */
export interface RequestConfig {
	/** The Roblox Open Cloud API key. */
	readonly apiKey: string;
	/** Base URL for the API, e.g. "https://apis.roblox.com". */
	readonly baseUrl: string;
	/** Optional request timeout in milliseconds. */
	readonly timeout?: number;
}

/**
 * HTTP transport abstraction. Implementations classify every response
 * into a typed {@link Result}.
 */
export interface HttpClient {
	/** Sends an HTTP request and classifies the response. */
	request(
		request: HttpRequest,
		config: RequestConfig,
	): Promise<Result<HttpResponse, OpenCloudError>>;
}
