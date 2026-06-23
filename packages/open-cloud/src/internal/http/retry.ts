import { ApiError } from "../../errors/api-error.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import { findErrorCode, isTimeoutAbort } from "../utils/find-error-code.ts";

/**
 * Fully-resolved retry config shape that {@link mergeConfig} and
 * {@link shouldRetry} operate on. Fields are required because this represents
 * the post-defaulting, internal view; callers should supply every field (or
 * resolve them via a test factory / client constructor). The partial,
 * user-facing type lives on client construction options; method defaults and
 * per-request overrides use `Partial<RetryResolvable>`.
 */
export interface RetryResolvable {
	/** Roblox Open Cloud API key. */
	readonly apiKey: string;
	/** Base URL for the Open Cloud API. */
	readonly baseUrl: string;
	/** Maximum retry attempts before giving up. */
	readonly maxRetries: number;
	/** Status codes that are eligible for retry. */
	readonly retryableStatuses: ReadonlyArray<number>;
	/**
	 * Node-style transport error codes ({@link findErrorCode}) eligible for
	 * retry when surfaced as a {@link NetworkError}. Empty for create
	 * operations by default; consumers opt a create in via a per-request
	 * override.
	 */
	readonly retryableTransportCodes: ReadonlyArray<string>;
	/** Fallback delay function when no server hint is available. */
	readonly retryDelay: (attempt: number) => number;
	/** Per-request timeout in milliseconds. */
	readonly timeout: number;
}

/**
 * Transient transport error codes that are safe to retry for idempotent
 * operations. Connection resets, timeouts, and DNS hiccups are recoverable on
 * a retry. A self-aborted request timeout carries no OS-level `code`, so
 * {@link shouldRetry} folds it into this set as `ETIMEDOUT` (via
 * {@link isTimeoutAbort}) for idempotent methods; create methods retry no
 * transport codes and so still never re-issue a timed-out write.
 *
 * @since 0.1.0
 */
export const TRANSIENT_TRANSPORT_CODES: ReadonlyArray<string> = Object.freeze([
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"EPIPE",
	"ENETUNREACH",
	"EHOSTDOWN",
	"EAI_AGAIN",
	"UND_ERR_SOCKET",
]);

/** Method-level retry defaults, keyed by {@link MethodKind}. */
type MethodDefaults = Readonly<
	Pick<RetryResolvable, "retryableStatuses" | "retryableTransportCodes">
>;

/**
 * Default retry policy for idempotent operations (read, list, update,
 * delete). Safe to retry on rate limits, transient server errors, and
 * transient transport failures.
 */
export const IDEMPOTENT_METHOD_DEFAULTS: MethodDefaults = Object.freeze({
	retryableStatuses: Object.freeze([429, 500, 502, 503, 504] as const),
	retryableTransportCodes: TRANSIENT_TRANSPORT_CODES,
});

/**
 * Default retry policy for create operations. Retries rate limits only (no
 * 5xx and no transport-error retries) to prevent duplicate resources, since
 * Roblox Open Cloud has no idempotency-key support. Consumers who can tolerate
 * a duplicate opt in per request.
 */
export const CREATE_METHOD_DEFAULTS: MethodDefaults = Object.freeze({
	retryableStatuses: Object.freeze([429] as const),
	retryableTransportCodes: Object.freeze([] as const),
});

/** Kind of HTTP method the merge is being performed for. */
export type MethodKind = "create" | "idempotent";

/**
 * Options for {@link mergeConfig}.
 *
 * @template T - Concrete `RetryResolvable` subtype being merged.
 */
interface MergeConfigOptions<T> {
	/** Method-level defaults (e.g. {@link CREATE_METHOD_DEFAULTS}). */
	readonly methodDefaults: Partial<T>;
	/** Whether the method is a create or idempotent operation. */
	readonly methodKind: MethodKind;
	/** Optional per-request overrides; always win when provided. */
	readonly requestOptions?: Partial<T>;
}

/**
 * Options for {@link computeRetryWaitMs}.
 */
interface ComputeRetryWaitMsOptions {
	/** Zero-indexed retry attempt number. */
	readonly attempt: number;
	/** Fallback delay function when no server hint is available. */
	readonly retryDelay: (attempt: number) => number;
}

/**
 * Default exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (capped).
 *
 * @example
 *
 * ```ts
 * import { defaultRetryDelay } from "./retry";
 *
 * expect(defaultRetryDelay(0)).toBe(1000);
 * expect(defaultRetryDelay(4)).toBe(16_000);
 * expect(defaultRetryDelay(10)).toBe(30_000);
 * ```
 *
 * @param attempt - Zero-indexed retry attempt number.
 * @returns Wait duration in milliseconds.
 */
export function defaultRetryDelay(attempt: number): number {
	return Math.min(1000 * 2 ** attempt, 30_000);
}

/**
 * Computes how long to wait before the next retry. Prefers the server's
 * suggested delay when the error is a {@link RateLimitError} with a positive
 * `retryAfterSeconds`; otherwise falls through to `retryDelay(attempt)`.
 *
 * @example
 *
 * ```ts
 * import { RateLimitError } from "../../errors/rate-limit.ts";
 * import { computeRetryWaitMs, defaultRetryDelay } from "./retry";
 *
 * const error = new RateLimitError("slow down", { retryAfterSeconds: 3 });
 *
 * expect(computeRetryWaitMs(error, { attempt: 0, retryDelay: defaultRetryDelay })).toBe(
 *     3000,
 * );
 * ```
 *
 * @example
 *
 * ```ts
 * import { ApiError } from "../../errors/api-error.ts";
 * import { computeRetryWaitMs, defaultRetryDelay } from "./retry";
 *
 * const error = new ApiError("server error", { statusCode: 503 });
 *
 * expect(computeRetryWaitMs(error, { attempt: 2, retryDelay: defaultRetryDelay })).toBe(
 *     4000,
 * );
 * ```
 *
 * @param error - The error returned by the failing request.
 * @param options - Retry attempt index and fallback delay function.
 * @returns Wait duration in milliseconds before the next attempt.
 */
export function computeRetryWaitMs(
	error: ApiError | NetworkError | RateLimitError,
	options: ComputeRetryWaitMsOptions,
): number {
	if (error instanceof RateLimitError && error.retryAfterSeconds > 0) {
		return error.retryAfterSeconds * 1000;
	}

	return options.retryDelay(options.attempt);
}

/**
 * Decides whether a failed request is eligible for retry. {@link RateLimitError}
 * (checked against 429) and {@link ApiError} (checked against its `statusCode`)
 * are retryable when their status is in `retryableStatuses`. A
 * {@link NetworkError} is retryable when its transport code
 * ({@link findErrorCode}) is in `retryableTransportCodes`. This is how
 * transient connection resets recover. A self-aborted request timeout
 * ({@link isTimeoutAbort}) carries no transport code, so it is classified as
 * `ETIMEDOUT`: recovered for idempotent methods, never for creates (whose
 * list is empty). All other failures return `false`.
 *
 * @example
 *
 * ```ts
 * import { RateLimitError } from "../../errors/rate-limit.ts";
 * import { shouldRetry } from "./retry";
 *
 * const error = new RateLimitError("", { retryAfterSeconds: 1 });
 *
 * expect(shouldRetry(error, { retryableStatuses: [429], retryableTransportCodes: [] })).toBe(
 *     true,
 * );
 * ```
 *
 * @example
 *
 * ```ts
 * import { NetworkError } from "../../errors/network-error.ts";
 * import { shouldRetry } from "./retry";
 *
 * const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
 * const error = new NetworkError("Network request failed", { cause: reset });
 *
 * expect(
 *     shouldRetry(error, { retryableStatuses: [], retryableTransportCodes: ["ECONNRESET"] }),
 * ).toBe(true);
 * ```
 *
 * @param error - The error returned by the failing request.
 * @param config - Object carrying the retry-eligible status and transport-code lists.
 * @returns `true` if the error should be retried, `false` otherwise.
 */
export function shouldRetry(
	error: unknown,
	config: {
		readonly retryableStatuses: ReadonlyArray<number>;
		readonly retryableTransportCodes: ReadonlyArray<string>;
	},
): error is ApiError | NetworkError | RateLimitError {
	if (error instanceof RateLimitError) {
		return config.retryableStatuses.includes(429);
	}

	if (error instanceof ApiError) {
		return config.retryableStatuses.includes(error.statusCode);
	}

	if (error instanceof NetworkError) {
		const code = findErrorCode(error) ?? (isTimeoutAbort(error) ? "ETIMEDOUT" : undefined);
		return code !== undefined && config.retryableTransportCodes.includes(code);
	}

	return false;
}

/**
 * Resolves the effective config for a single request by shallow-merging the
 * client config, method defaults, and per-request options. Precedence depends
 * on `methodKind`:
 *
 * - `"create"`: method defaults override client config, so client-level
 *   settings cannot silently relax create-method safety. Only explicit
 *   per-request `requestOptions` can.
 * - `"idempotent"`: client config overrides method defaults, so consumers
 *   can loosen or tighten retry policy globally. `requestOptions` still wins
 *   when provided.
 *
 * Array-valued fields like `retryableStatuses` are *replaced*, not extended.
 *
 * @template T - Concrete `RetryResolvable` subtype being merged.
 *
 * @example
 *
 * ```ts
 * import {
 *     CREATE_METHOD_DEFAULTS,
 *     defaultRetryDelay,
 *     mergeConfig,
 *     type RetryResolvable,
 * } from "./retry";
 *
 * const clientConfig: RetryResolvable = {
 *     apiKey: "k",
 *     baseUrl: "https://apis.roblox.com",
 *     maxRetries: 3,
 *     retryableStatuses: [429, 500],
 *     retryableTransportCodes: [],
 *     retryDelay: defaultRetryDelay,
 *     timeout: 30_000,
 * };
 *
 * const merged = mergeConfig(clientConfig, {
 *     methodDefaults: CREATE_METHOD_DEFAULTS,
 *     methodKind: "create",
 * });
 *
 * expect(merged.retryableStatuses).toStrictEqual([429]);
 * ```
 *
 * @example
 *
 * ```ts
 * import {
 *     defaultRetryDelay,
 *     IDEMPOTENT_METHOD_DEFAULTS,
 *     mergeConfig,
 *     type RetryResolvable,
 * } from "./retry";
 *
 * const clientConfig: RetryResolvable = {
 *     apiKey: "k",
 *     baseUrl: "https://apis.roblox.com",
 *     maxRetries: 3,
 *     retryableStatuses: [429],
 *     retryableTransportCodes: [],
 *     retryDelay: defaultRetryDelay,
 *     timeout: 30_000,
 * };
 *
 * const merged = mergeConfig(clientConfig, {
 *     methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
 *     methodKind: "idempotent",
 *     requestOptions: { timeout: 10_000 },
 * });
 *
 * expect(merged.retryableStatuses).toStrictEqual([429]);
 * expect(merged.timeout).toBe(10_000);
 * ```
 *
 * @param clientConfig - Config frozen at client construction.
 * @param options - Method defaults, method kind, and optional per-request overrides.
 * @returns A new merged config object. Inputs are not mutated.
 */
export function mergeConfig<T extends RetryResolvable>(
	clientConfig: T,
	options: MergeConfigOptions<T>,
): T {
	const { methodDefaults, methodKind, requestOptions } = options;

	switch (methodKind) {
		case "create": {
			return { ...clientConfig, ...methodDefaults, ...requestOptions };
		}
		case "idempotent": {
			return { ...methodDefaults, ...clientConfig, ...requestOptions };
		}
		default: {
			const exhaustive: never = methodKind;
			throw new Error(`Unexpected methodKind: ${String(exhaustive)}`);
		}
	}
}
