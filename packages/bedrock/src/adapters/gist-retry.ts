const MAX_RETRIES = 6;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 16_000;
// Longest wait this schedule sits out on GitHub's say-so, per attempt. A
// throttle naming more than this is reported instead.
const MAX_THROTTLE_WAIT_MS = 30_000;
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
 * clears within the schedule's reach: a write conflict, a gateway failure, or
 * a throttle naming a wait short enough to sit out. A throttle is waited out
 * for exactly the wait it names; everything else backs off exponentially with
 * jitter.
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

		await retry.sleep(throttleWaitMs(response) ?? backoffMs(attempt, retry.random));
		response = await operation();
	}

	return response;
}

function backoffMs(attempt: number, random: () => number): number {
	const cap = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
	const half = cap / 2;
	return half + random() * half;
}

/**
 * The wait a throttled response names, when the schedule can sit it out.
 *
 * A 403 is the only status GitHub throttles with, and `Retry-After` is the
 * only header naming how long for. Its absence leaves a 403 that no wait
 * clears: a refused credential, or the hourly budget, which refills on a
 * clock beyond this schedule's reach.
 *
 * @param response - The response to read a wait from.
 * @returns The wait in milliseconds, or `undefined` when there is none to
 * sit out.
 */
function throttleWaitMs(response: Response): number | undefined {
	if (response.status !== 403) {
		return undefined;
	}

	const value = response.headers.get("retry-after");
	if (value === null) {
		return undefined;
	}

	// GitHub sends a count of seconds. HTTP also permits an absolute date,
	// which parses to NaN here and names no wait this schedule can sit out.
	const seconds = Number(value);
	if (!Number.isInteger(seconds)) {
		return undefined;
	}

	const wait = seconds * 1000;
	return wait > MAX_THROTTLE_WAIT_MS ? undefined : wait;
}

function isRetryable(response: Response): boolean {
	return RETRYABLE_STATUSES.has(response.status) || throttleWaitMs(response) !== undefined;
}
