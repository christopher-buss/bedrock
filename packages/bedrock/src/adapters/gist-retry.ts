import { isRateLimited } from "./gist-http-errors.ts";

const MAX_RETRIES = 6;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 16_000;
// Longest wait the adapter will sit out on GitHub's say-so. A throttle can
// name a wait longer than a CI job has left, and sleeping it out would spend
// that budget on a request which has not been sent yet.
const MAX_RETRY_AFTER_MS = 30_000;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([409, 502, 503, 504]);

/** Injection seams a retry schedule needs. */
export interface RetryDependencies {
	/** Source of the jitter each backoff is spread by. */
	readonly random: () => number;
	/** How the schedule waits between attempts. */
	readonly sleep: (ms: number) => Promise<void>;
}

/**
 * Run `operation`, re-attempting while GitHub answers with something that
 * clears on its own: a write conflict, a gateway failure, or a throttle. A
 * throttle naming its own wait is waited out on GitHub's terms; everything
 * else backs off exponentially with jitter.
 *
 * @param retry - Jitter and sleep seams the schedule runs on.
 * @param operation - The request to send, once per attempt.
 * @returns The first response that succeeded or that no retry can improve,
 * and otherwise the last one the budget allowed.
 */
export async function withRetryAsync(
	retry: RetryDependencies,
	operation: () => Promise<Response>,
): Promise<Response> {
	let response = await operation();
	for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
		if (response.ok || !isRetryable(response)) {
			return response;
		}

		await retry.sleep(retryAfterMs(response.headers) ?? backoffMs(attempt, retry.random));
		response = await operation();
	}

	return response;
}

function backoffMs(attempt: number, random: () => number): number {
	const cap = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
	const half = cap / 2;
	return half + random() * half;
}

function isRetryable(response: Response): boolean {
	if (RETRYABLE_STATUSES.has(response.status)) {
		return true;
	}

	// A throttled 403 clears on its own; an unauthorized one never does, so
	// only the throttle earns another attempt.
	return response.status === 403 && isRateLimited(response.headers);
}

function retryAfterMs(headers: Headers): number | undefined {
	const value = headers.get("retry-after");
	if (value === null) {
		return undefined;
	}

	// GitHub sends a count of seconds. HTTP also permits an absolute date,
	// which parses to NaN here and leaves the backoff schedule to decide.
	const seconds = Number(value);
	if (!Number.isInteger(seconds)) {
		return undefined;
	}

	return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}
