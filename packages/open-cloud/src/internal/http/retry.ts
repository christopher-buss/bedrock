import { ApiError } from "../../errors/api-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";

/**
 * Options for {@link computeRetryWaitMs}.
 */
export interface ComputeRetryWaitMsOptions {
	/** Zero-indexed retry attempt number. */
	readonly attempt: number;
	/** Fallback delay function when no server hint is available. */
	readonly retryDelay: (attempt: number) => number;
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
