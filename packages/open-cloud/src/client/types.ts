import type { OpenCloudError } from "../errors/base.ts";
import type { SleepFunc } from "../internal/utils/sleep.ts";
import type { Result } from "../types.ts";

export type { SleepFunc } from "../internal/utils/sleep.ts";

/**
 * Why a logical request is waiting for SDK-managed admission.
 *
 * @example
 *
 * ```ts
 * import type { AdmissionWaitReason } from "@bedrock-rbx/ocale";
 *
 * const reason: AdmissionWaitReason = "retry-delay";
 * expect(reason).toBe("retry-delay");
 * ```
 *
 * @since 0.3.1
 */
export type AdmissionWaitReason =
	| "operation-capacity"
	| "operation-queue"
	| "reported-budget"
	| "retry-delay";

/**
 * One boundary in a request's SDK-managed admission-wait lifecycle.
 *
 * `durationMs` is the scheduler's intended duration, not elapsed wall time,
 * and is absent when the SDK cannot know the duration up front.
 *
 * @example
 *
 * ```ts
 * import type { AdmissionWaitEvent } from "@bedrock-rbx/ocale";
 *
 * const event: AdmissionWaitEvent = {
 *     durationMs: 500,
 *     phase: "started",
 *     reason: "reported-budget",
 * };
 * expect(event.durationMs).toBe(500);
 * ```
 *
 * @since 0.3.1
 */
export interface AdmissionWaitEvent {
	/** Intended wait duration in milliseconds, when known. */
	readonly durationMs?: number;
	/** Whether the wait has just begun or has finished. */
	readonly phase: "ended" | "started";
	/** SDK admission mechanism responsible for the wait. */
	readonly reason: AdmissionWaitReason;
}

/**
 * Receives request-scoped admission-wait lifecycle notifications.
 *
 * @example
 *
 * ```ts
 * import type { AdmissionWaitEvent, AdmissionWaitObserver } from "@bedrock-rbx/ocale";
 *
 * const events: AdmissionWaitEvent[] = [];
 * const observer: AdmissionWaitObserver = (event) => events.push(event);
 * observer({ phase: "started", reason: "operation-queue" });
 * expect(events).toHaveLength(1);
 * ```
 *
 * @since 0.3.1
 */
export type AdmissionWaitObserver = (event: AdmissionWaitEvent) => unknown;

/**
 * How a client authenticates to Open Cloud. Pass it as
 * {@link OpenCloudClientOptions.credential}, or for one call as
 * `credential` on {@link RequestOptions}.
 *
 * @example
 *
 * ```ts
 * import type { Credential } from "@bedrock-rbx/ocale";
 *
 * const credential: Credential = { apiKey: "your-key", kind: "apiKey" };
 * expect(credential.kind).toBe("apiKey");
 * ```
 *
 * @since unreleased
 */
export type Credential =
	| {
			/**
			 * Returns a current OAuth 2.0 access token. The client calls it
			 * once per transport attempt, after every admission wait (retry
			 * backoff, rate-limit queue, budget gate) and just before the
			 * send, with the request's `signal`. It may return the token or a
			 * promise of it.
			 *
			 * Contract: return a token that stays valid for at least 60 s, and
			 * throw (or reject) when no such token is available. A throw ends
			 * the call with a `CredentialError` whose `cause` is the thrown
			 * value, and spends no retry.
			 */
			readonly getAccessToken: (context: {
				readonly signal: AbortSignal;
			}) => Promise<string> | string;
			/**
			 * Stable, caller-chosen name of the grant, for example the Roblox
			 * user id. It keys the rate-limit queue and the budget gate, so
			 * it must not change when the token rotates.
			 */
			readonly identity: string;
			/** Selects OAuth authentication, sent as a Bearer token. */
			readonly kind: "oauth";
	  }
	| {
			/** The Roblox Open Cloud API key. */
			readonly apiKey: string;
			/** Selects API-key authentication, sent as `x-api-key`. */
			readonly kind: "apiKey";
	  };

/**
 * The credential a transport receives on {@link RequestConfig.credential},
 * ready to turn into a request header.
 *
 * @since unreleased
 */
export type ResolvedCredential =
	| {
			/** The OAuth access token, sent as `Authorization: Bearer`. */
			readonly accessToken: string;
			/** Selects OAuth authentication. */
			readonly kind: "oauth";
	  }
	| {
			/** The Roblox Open Cloud API key, sent as `x-api-key`. */
			readonly apiKey: string;
			/** Selects API-key authentication. */
			readonly kind: "apiKey";
	  };

/**
 * A normalized HTTP request to send to the Roblox Open Cloud API.
 *
 * @since 0.1.0
 */
export interface HttpRequest {
	/** The request body. */
	readonly body?: HttpRequestBody;
	/**
	 * Caller-supplied request headers. Applied after the transport sets the
	 * credential header and any body-driven `Content-Type`, so a
	 * caller-supplied header replaces the transport's default. `x-api-key`
	 * and `authorization` are skipped, so a request header cannot replace
	 * the configured credential.
	 */
	readonly headers?: Readonly<Record<string, string>>;
	/** The HTTP method. */
	readonly method: "DELETE" | "GET" | "PATCH" | "POST";
	/** Relative path, e.g. `/game-passes/v1/universes/123/...`. */
	readonly url: string;
}

/**
 * A normalized HTTP response from the Roblox Open Cloud API.
 *
 * @since 0.1.0
 */
export interface HttpResponse {
	/**
	 * The parsed response body. `undefined` when the response had an empty
	 * body (for example HTTP 204 No Content, or any other status where the
	 * server returned no payload).
	 */
	readonly body: unknown;
	/** Response headers with lowercased keys. */
	readonly headers: Readonly<Record<string, string>>;
	/** The HTTP status code. */
	readonly status: number;
}

/**
 * Per-request configuration passed to {@link HttpClient.request}.
 *
 * @since 0.1.0
 */
export interface RequestConfig {
	/** Base URL for the API, e.g. `https://apis.roblox.com`. */
	readonly baseUrl: string;
	/** The resolved credential for this request. */
	readonly credential: ResolvedCredential;
	/** Caller cancellation signal for this request. */
	readonly signal?: AbortSignal;
	/** Optional request timeout in milliseconds. */
	readonly timeout?: number;
}

/**
 * HTTP transport abstraction. Implementations classify every response into
 * a typed {@link Result}.
 *
 * A custom implementation receives the resolved credential on
 * {@link RequestConfig.credential}. Ocale passes its results and errors
 * through unchanged, so they are outside the guarantee that ocale-built
 * errors and hook arguments never hold the API key or the access token.
 * The same applies to `NetworkError.cause` from a wrapped `fetch`,
 * `CredentialError.cause` from the token provider, and `ApiError.details`
 * from a Roblox response body.
 *
 * @since 0.1.0
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
 *
 * @since 0.1.0
 */
export interface OpenCloudHooks {
	/** Fired before the SDK sleeps for a computed retry or rate-limit wait. */
	readonly onRateLimit?: (waitMs: number) => void;
	/** Fired before each HTTP attempt (including retries). */
	readonly onRequest?: (request: HttpRequest) => void;
	/**
	 * Fired before each wait that precedes a retry. `attempt` is 1-indexed and
	 * counts every such wait, including server-guided rate-limit waits that do
	 * not spend `maxRetries`, so it can exceed `maxRetries`.
	 */
	readonly onRetry?: (attempt: number, error: OpenCloudError) => void;
}

/**
 * Options accepted by every resource client constructor. Cross-cutting
 * configuration that applies to all requests made through the client instance.
 *
 * @since 0.1.0
 */
export interface OpenCloudClientOptions {
	/** Base URL for the Open Cloud API. Defaults to `https://apis.roblox.com`. */
	readonly baseUrl?: string;
	/**
	 * The credential used as the default for every request.
	 *
	 * For an OAuth credential, `getAccessToken` must return a token that
	 * stays valid for at least 60 s, and must throw (or reject) when it
	 * cannot. The client calls it once per transport attempt, after every
	 * admission wait, with the request's `signal`. A throw returns a
	 * `CredentialError` with the provider error as `cause` and spends
	 * no retry. The provider's own error is passed through unchanged, so
	 * scrub any secret from it yourself.
	 *
	 * No message, error, `cause` chain or hook argument that ocale builds
	 * holds the API key or the access token. These values pass through
	 * from outside ocale and are not covered:
	 *
	 * - anything a custom {@link HttpClient} returns or throws;
	 * - `NetworkError.cause`, the error thrown by a wrapped `fetch`;
	 * - `CredentialError.cause`, the error thrown by `getAccessToken`;
	 * - `ApiError.details`, the response body Roblox sent.
	 */
	readonly credential: Credential;
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
	/**
	 * Maximum retry attempts. Defaults to `3`. A rate limit whose response
	 * says how long to wait is waited out without spending an attempt; leave
	 * `429` out of `retryableStatuses` to stop retrying rate limits at all.
	 */
	readonly maxRetries?: number;
	/**
	 * Status codes eligible for retry. Defaults to the idempotent-method set
	 * `[429, 500, 502, 503, 504]`. Resource clients may tighten this per
	 * method (e.g. `create` only retries `429`).
	 */
	readonly retryableStatuses?: ReadonlyArray<number>;
	/**
	 * Node-style transport error codes eligible for retry when a request fails
	 * with a `NetworkError` (e.g. `["ECONNRESET", "ETIMEDOUT"]`).
	 * Defaults to the idempotent-method transient set. Create methods default
	 * to none and cannot be relaxed by a client-level value. Pass the exported
	 * `TRANSIENT_TRANSPORT_CODES` set (or your own subset) on a single call's
	 * {@link RequestOptions} to opt a create into transport retries when a
	 * duplicate resource is acceptable.
	 */
	readonly retryableTransportCodes?: ReadonlyArray<string>;
	/** Fallback delay function used when no server hint is available. */
	readonly retryDelay?: (attempt: number) => number;
	/**
	 * Plug in a custom {@link SleepFunc} used between retry attempts and
	 * for rate-limit waits. Useful for integrating with a custom
	 * scheduler or virtual clock. Most consumers leave this unset and
	 * use the default `setTimeout`-backed sleep.
	 */
	readonly sleep?: SleepFunc;
	/**
	 * Default per-request timeout in milliseconds for JSON-bound methods,
	 * defaulting to `30_000`. Upload methods (those whose request body is
	 * `FormData` or `Uint8Array`, such as place publishes and icon uploads)
	 * have no default timeout and ignore this option: upload latency is
	 * bandwidth-bound, and the SDK cannot size a wall-clock budget without
	 * knowing payload size and link quality. Set a transport-attempt timeout
	 * on any single call, upload or otherwise, with `options.timeout`.
	 */
	readonly timeout?: number;
}

/**
 * Per-request override shape. Any subset of the overridable client options
 * may be supplied for a single request; omitted fields fall through to the
 * client-level defaults.
 *
 * @since 0.1.0
 */
export type RequestOptions = Partial<
	Pick<
		OpenCloudClientOptions,
		| "baseUrl"
		| "credential"
		| "maxRetries"
		| "retryableStatuses"
		| "retryableTransportCodes"
		| "retryDelay"
		| "timeout"
	>
> & {
	/**
	 * Absolute Unix timestamp in milliseconds by which this logical request
	 * must finish. SDK-managed waits that cannot fit fail with a typed
	 * `RequestDeadlineExceededError` instead of consuming the remaining budget.
	 */
	readonly deadlineMs?: number;
	/**
	 * Receives the admission waits entered by this logical request only.
	 * Notifications cannot alter scheduling or retry behavior.
	 */
	readonly onAdmissionWait?: AdmissionWaitObserver;
	/** Cancels this request at any point in its lifecycle. */
	readonly signal?: AbortSignal;
};

/**
 * Supported request body types.
 *
 * - `FormData` for multipart uploads (Content-Type set automatically by
 *   fetch).
 * - `Record<string, unknown>` for JSON bodies (serialized with
 *   `JSON.stringify`).
 * - `Uint8Array<ArrayBuffer>` for raw binary uploads (default Content-Type is
 *   `application/octet-stream`; override via {@link HttpRequest.headers}).
 *   `SharedArrayBuffer`-backed views are not accepted by `fetch`; wrap them
 *   via `new Uint8Array(bytes)` to obtain an `ArrayBuffer`-backed copy.
 * - `undefined` for requests without a body (GET, DELETE).
 */
type HttpRequestBody = FormData | Record<string, unknown> | Uint8Array<ArrayBuffer> | undefined;
