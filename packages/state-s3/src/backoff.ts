// Where the backoff starts and where it stops growing. The ceiling bounds
// how long a hold given up early sits unnoticed.
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/**
 * One backoff, given how many attempts have been refused and how long is left.
 */
export interface BackoffInputs {
	/** How many acquisition attempts have been refused so far, from 1. */
	readonly attempt: number;
	/** Milliseconds left before acquisition gives up. */
	readonly remainingMs: number;
}

/**
 * How long to wait before the next acquisition attempt.
 *
 * The delay doubles per refused attempt up to a ceiling, clamped to what is
 * left of the timeout so the last attempt lands on the deadline.
 *
 * @param inputs - How many attempts have been refused, and how long is
 * left.
 * @returns Milliseconds to wait.
 */
export function backoffDelayMs({ attempt, remainingMs }: BackoffInputs): number {
	const grown = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
	return Math.max(Math.min(grown, remainingMs), 0);
}
