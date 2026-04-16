import { ApiError } from "../../errors/api-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";

/**
 * Shape of the fields {@link mergeConfig} and {@link shouldRetry} read. Kept
 * local so this module does not block on the future client options type that
 * will land with the resource clients.
 */
export interface RetryResolvable {
	/** Roblox Open Cloud API key. */
	readonly apiKey?: string;
	/** Override base URL (defaults to the production Open Cloud host). */
	readonly baseUrl?: string;
	/** Maximum retry attempts before giving up. */
	readonly maxRetries?: number;
	/** Status codes that are eligible for retry. */
	readonly retryableStatuses?: ReadonlyArray<number>;
	/** Fallback delay function when no server hint is available. */
	readonly retryDelay?: (attempt: number) => number;
	/** Per-request timeout in milliseconds. */
	readonly timeout?: number;
}

/**
 * Default retry status codes for idempotent operations (read, list, update,
 * delete). Safe to retry on both rate limits and transient server errors.
 */
export const IDEMPOTENT_METHOD_DEFAULTS: Readonly<
	Pick<Required<RetryResolvable>, "retryableStatuses">
> = Object.freeze({
	retryableStatuses: Object.freeze([429, 500, 502, 503, 504] as const),
});

/**
 * Default retry status codes for create operations. Retries rate limits only,
 * to prevent duplicate resources on 5xx (Roblox Open Cloud has no
 * idempotency-key support).
 */
export const CREATE_METHOD_DEFAULTS: Readonly<
	Pick<Required<RetryResolvable>, "retryableStatuses">
> = Object.freeze({
	retryableStatuses: Object.freeze([429] as const),
});

/**
 * Options for {@link computeRetryWaitMs}.
 */
export interface ComputeRetryWaitMsOptions {
	/** Zero-indexed retry attempt number. */
	readonly attempt: number;
	/** Fallback delay function when no server hint is available. */
	readonly retryDelay: (attempt: number) => number;
}

/** Kind of HTTP method the merge is being performed for. */
export type MethodKind = "create" | "idempotent";

/**
 * Options for {@link mergeConfig}.
 *
 * @template T - Concrete `RetryResolvable` subtype being merged.
 */
export interface MergeConfigOptions<T> {
	/** Method-level defaults (e.g. {@link CREATE_METHOD_DEFAULTS}). */
	readonly methodDefaults: Partial<T>;
	/** Whether the method is a create or idempotent operation. */
	readonly methodKind: MethodKind;
	/** Optional per-request overrides; always win when provided. */
	readonly requestOptions?: Partial<T>;
}

/**
 * Default exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (capped).
 *
 * @example
 * defaultRetryDelay(0); // 1000
 * defaultRetryDelay(4); // 16000
 * defaultRetryDelay(10); // 30000 (capped)
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
 * // Adaptive 429 recovery
 * const error = new RateLimitError("slow down", { retryAfterSeconds: 3 });
 * computeRetryWaitMs(error, { attempt: 0, retryDelay: defaultRetryDelay }); // 3000
 *
 * @example
 * // Exponential fallback for 5xx
 * const error = new ApiError("server error", { statusCode: 503 });
 * computeRetryWaitMs(error, { attempt: 2, retryDelay: defaultRetryDelay }); // 4000
 *
 * @param error - The error returned by the failing request.
 * @param options - Retry attempt index and fallback delay function.
 * @returns Wait duration in milliseconds before the next attempt.
 */
export function computeRetryWaitMs(
	error: ApiError | RateLimitError,
	options: ComputeRetryWaitMsOptions,
): number {
	if (error instanceof RateLimitError && error.retryAfterSeconds > 0) {
		return error.retryAfterSeconds * 1000;
	}

	return options.retryDelay(options.attempt);
}

/**
 * Decides whether a failed request is eligible for retry under the given
 * `retryableStatuses`. Only {@link RateLimitError} (checked against 429) and
 * {@link ApiError} (checked against its `statusCode`) are retryable — network
 * errors and other failures always return `false`.
 *
 * @example
 * // Rate-limit retries enabled
 * shouldRetry(new RateLimitError("", { retryAfterSeconds: 1 }), {
 *     retryableStatuses: [429],
 * }); // true
 *
 * @example
 * // 5xx retry enabled on idempotent methods
 * shouldRetry(new ApiError("", { statusCode: 503 }), {
 *     retryableStatuses: [429, 500, 502, 503, 504],
 * }); // true
 *
 * @example
 * // Network errors are never retried by this helper
 * shouldRetry(new NetworkError("offline"), { retryableStatuses: [429] }); // false
 *
 * @param error - The error returned by the failing request.
 * @param config - Object carrying the retry-eligible status list.
 * @returns `true` if the error should be retried, `false` otherwise.
 */
export function shouldRetry(
	error: unknown,
	config: { readonly retryableStatuses: ReadonlyArray<number> },
): boolean {
	if (error instanceof RateLimitError) {
		return config.retryableStatuses.includes(429);
	}

	if (error instanceof ApiError) {
		return config.retryableStatuses.includes(error.statusCode);
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
 * @example
 * // Create method: client [429, 500] + CREATE defaults [429] → [429]
 * mergeConfig(
 *     { apiKey: "k", retryableStatuses: [429, 500] },
 *     { methodDefaults: CREATE_METHOD_DEFAULTS, methodKind: "create" },
 * );
 *
 * @example
 * // Idempotent method: client wins over method defaults
 * mergeConfig(
 *     { apiKey: "k", retryableStatuses: [429] },
 *     {
 *         methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
 *         methodKind: "idempotent",
 *         requestOptions: { timeout: 10_000 },
 *     },
 * );
 *
 * @template T - Concrete `RetryResolvable` subtype being merged.
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

	if (methodKind === "create") {
		return { ...clientConfig, ...methodDefaults, ...requestOptions };
	}

	return { ...methodDefaults, ...clientConfig, ...requestOptions };
}
