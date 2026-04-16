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
