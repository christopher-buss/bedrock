import type { RateLimitSample } from "./rate-limit-sample.ts";

const MS_PER_SECOND = 1000;

/** Live window state for one scope: budget left and when it resets. */
interface WindowState {
	/** Best estimate of requests still allowed before the window resets. */
	predictedRemaining: number;
	/** Absolute time (ms) the window resets to full. */
	resetAt: number;
}

/**
 * Tracks the live rate-limit budget for a single scope (one operation, or one
 * API key). Primed by `observe` from response headers and drawn down by
 * `reserve` as requests leave, so `waitMs` can hold a request that would
 * otherwise be throttled until the window resets. Budget and reset time move
 * together as one window, so the tracker is either unprimed or fully primed —
 * never half-known.
 */
export class BudgetTracker {
	#window: undefined | WindowState = undefined;

	/**
	 * Folds a fresh server reading in, replacing any prior window. The latest
	 * reading wins: observe time is monotonic, so the most recently resolved
	 * response is the best current estimate.
	 *
	 * @param sample - Parsed `remaining`/`resetSeconds` from a response.
	 * @param now - The current time in ms.
	 */
	public observe(sample: RateLimitSample, now: number): void {
		this.#window = {
			predictedRemaining: sample.remaining,
			resetAt: now + sample.resetSeconds * MS_PER_SECOND,
		};
	}

	/**
	 * Accounts for one request leaving by decrementing the prediction. A
	 * no-op while unprimed; an expired window is handled by `waitMs` clamping
	 * to zero, so no roll bookkeeping is needed here.
	 */
	public reserve(): void {
		if (this.#window !== undefined) {
			this.#window.predictedRemaining -= 1;
		}
	}

	/**
	 * Milliseconds to wait before the next request is allowed.
	 *
	 * @param now - The current time in ms.
	 * @returns `0` when a request may go now (unprimed, budget remains, or the
	 *   window has already passed); otherwise the time until reset.
	 */
	public waitMs(now: number): number {
		if (this.#window === undefined || this.#window.predictedRemaining > 0) {
			return 0;
		}

		return Math.max(0, this.#window.resetAt - now);
	}
}
