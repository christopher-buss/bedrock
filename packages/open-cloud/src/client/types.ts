import type { OpenCloudError } from "../errors/base.ts";
import type { SleepFunc } from "../internal/utils/sleep.ts";
import type { Result } from "../types.ts";

export type { SleepFunc } from "../internal/utils/sleep.ts";

/**
 * Supported request body types.
 *
 * - `FormData` for multipart uploads (Content-Type set automatically by fetch).
 * - `Record<string, unknown>` for JSON bodies (serialized with `JSON.stringify`).
 * - `Uint8Array<ArrayBuffer>` for raw binary uploads (default Content-Type is
 *   `application/octet-stream`; override via {@link HttpRequest.headers}).
 *   `SharedArrayBuffer`-backed views are not accepted by `fetch`; wrap them
 *   via `new Uint8Array(bytes)` to obtain an `ArrayBuffer`-backed copy.
 * - `undefined` for requests without a body (GET, DELETE).
 */
export type HttpRequestBody =
	| FormData
	| Record<string, unknown>
	| Uint8Array<ArrayBuffer>
	| undefined;

/**
 * A normalized HTTP request to send to the Roblox Open Cloud API.
 */
export interface HttpRequest {
	/** The request body. */
	readonly body?: HttpRequestBody;
	/**
	 * Caller-supplied request headers. Applied after the transport sets
	 * `x-api-key` and any body-driven `Content-Type`, so a caller-supplied
	 * header replaces the transport's default.
	 */
	readonly headers?: Readonly<Record<string, string>>;
	/** The HTTP method. */
	readonly method: "DELETE" | "GET" | "PATCH" | "POST";
	/** Relative path, e.g. `/game-passes/v1/universes/123/...`. */
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
	/** Base URL for the API, e.g. `https://apis.roblox.com`. */
	readonly baseUrl: string;
	/** Optional request timeout in milliseconds. */
	readonly timeout?: number;
}

/**
 * HTTP transport abstraction. Implementations classify every response into
 * a typed {@link Result}.
 */
export interface HttpClient {
	/** Sends an HTTP request and classifies the response. */
	request(
		request: HttpRequest,
		config: RequestConfig,
	): Promise<Result<HttpResponse, OpenCloudError>>;
}

/**
 * Client-level observability hooks. All hooks are notification-only and
 * fire-and-forget; they cannot alter retry behaviour.
 */
export interface OpenCloudHooks {
	/** Fired before the SDK sleeps for a computed retry or rate-limit wait. */
	readonly onRateLimit?: (waitMs: number) => void;
	/** Fired before each HTTP attempt (including retries). */
	readonly onRequest?: (request: HttpRequest) => void;
	/** Fired before a retry is attempted. `attempt` is 1-indexed. */
	readonly onRetry?: (attempt: number, error: OpenCloudError) => void;
}

/**
 * Options accepted by every resource client constructor. Cross-cutting
 * configuration that applies to all requests made through the client instance.
 */
export interface OpenCloudClientOptions {
	/** The Roblox Open Cloud API key used as the default for every request. */
	readonly apiKey: string;
	/** Base URL for the Open Cloud API. Defaults to `https://apis.roblox.com`. */
	readonly baseUrl?: string;
	/** Optional observability hooks. */
	readonly hooks?: OpenCloudHooks;
	/**
	 * Plug in a custom {@link HttpClient} to wrap or replace the default
	 * fetch-backed transport. Useful for wrapping `fetch` with tracing
	 * or metrics, routing through a custom proxy, or feeding the SDK
	 * from a recorded-fixture or replay layer. Most consumers leave this
	 * unset and use the default.
	 */
	readonly httpClient?: HttpClient;
	/** Maximum retry attempts. Defaults to `3`. */
	readonly maxRetries?: number;
	/**
	 * Status codes eligible for retry. Defaults to the idempotent-method set
	 * `[429, 500, 502, 503, 504]`. Resource clients may tighten this per
	 * method (e.g. `create` only retries `429`).
	 */
	readonly retryableStatuses?: ReadonlyArray<number>;
	/** Fallback delay function used when no server hint is available. */
	readonly retryDelay?: (attempt: number) => number;
	/**
	 * Plug in a custom {@link SleepFunc} used between retry attempts and
	 * for rate-limit waits. Useful for integrating with a custom
	 * scheduler or virtual clock. Most consumers leave this unset and
	 * use the default `setTimeout`-backed sleep.
	 */
	readonly sleep?: SleepFunc;
	/** Per-request timeout in milliseconds. Defaults to `30_000`. */
	readonly timeout?: number;
}

/**
 * Per-request override shape. Any subset of the overridable client options
 * may be supplied for a single request; omitted fields fall through to the
 * client-level defaults.
 */
export type RequestOptions = Partial<
	Pick<
		OpenCloudClientOptions,
		"apiKey" | "baseUrl" | "maxRetries" | "retryableStatuses" | "retryDelay" | "timeout"
	>
>;
