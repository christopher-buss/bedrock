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
 * Tracks the live rate-limit budget for a single scope. Primed by `observe`
 * from response headers and drawn down by `reserve` as requests leave, so
 * `waitMs` can pace requests across the window.
 *
 * Pacing has two regimes. While budget remains, requests are spread evenly over
 * the time left in the window (`timeLeft / remaining`), so a burst does not
 * spend the whole window's budget up front and then stall. Once the budget is
 * spent, requests hold until the window resets. Budget and reset time move
 * together as one window, so the tracker is either unprimed or fully primed —
 * never half-known.
 */
export class BudgetTracker {
	/** Time (ms) the most recent request was allowed out, for spacing. */
	#lastAllowedAt: number | undefined = undefined;
	#window: undefined | WindowState = undefined;

	/**
	 * Folds a fresh server reading in, replacing any prior window. The latest
	 * reading wins: observe time is monotonic, so the most recently resolved
	 * response is the best current estimate. The spacing reference is left
	 * untouched so a window refresh does not reset pacing mid-stream.
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
	 * Accounts for one request leaving at `now`: records the spacing reference
	 * and decrements the prediction. A no-op on the prediction while unprimed.
	 *
	 * @param now - The time the request was allowed out, in ms.
	 */
	public reserve(now: number): void {
		this.#lastAllowedAt = now;
		if (this.#window !== undefined) {
			this.#window.predictedRemaining -= 1;
		}
	}

	/**
	 * Milliseconds to wait before the next request is allowed.
	 *
	 * @param now - The current time in ms.
	 * @returns `0` when a request may go now (unprimed, or the first paced send);
	 *   the time until reset when the budget is spent; otherwise the time until
	 *   this request's evenly-spaced slot.
	 */
	public waitMs(now: number): number {
		if (this.#window === undefined) {
			return 0;
		}

		const { predictedRemaining, resetAt } = this.#window;
		if (predictedRemaining <= 0) {
			return Math.max(0, resetAt - now);
		}

		if (this.#lastAllowedAt === undefined) {
			return 0;
		}

		const interval = (resetAt - now) / predictedRemaining;
		return Math.max(0, this.#lastAllowedAt + interval - now);
	}
}
