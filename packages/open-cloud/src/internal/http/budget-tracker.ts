import type { RateLimitSample, RateLimitWindow } from "./rate-limit-sample.ts";

const MS_PER_SECOND = 1000;

/** Live window state for one scope: budget left and when it resets. */
interface WindowState {
	/** Best estimate of requests still allowed before the window resets. */
	readonly predictedRemaining: number;
	/** Absolute time (ms) the window resets to full. */
	readonly resetAt: number;
	/**
	 * Fixed spacing (ms) between sends in a window opened by rollover, or
	 * `undefined` for a window a server reading primed.
	 */
	readonly spacingMs?: number;
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
 * together as one window, so the tracker is either unprimed or fully primed,
 * never half-known.
 *
 * Once a primed window's reset passes with no fresh reading, the next window
 * opens holding the scope's capacity: the last capacity a response reported,
 * or the operation's documented one. Requests queued behind a reset are
 * admitted at that capacity per window, spaced one window-length divided by
 * capacity apart.
 */
export class BudgetTracker {
	/** Time (ms) the most recent request was allowed out, for spacing. */
	#lastAllowedAt: number | undefined = undefined;
	/** Requests the server grants per window, used when a window rolls over. */
	#rolloverWindow: RateLimitWindow;
	#window: undefined | WindowState = undefined;

	/**
	 * Creates a tracker for one scope.
	 *
	 * @param documentedWindow - The operation's documented capacity, used
	 *   until a response reports one.
	 */
	constructor(documentedWindow: RateLimitWindow) {
		this.#rolloverWindow = documentedWindow;
	}

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
		this.#rolloverWindow = sample.window ?? this.#rolloverWindow;
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
		const window = this.#windowAt(now);
		if (window !== undefined) {
			this.#window = { ...window, predictedRemaining: window.predictedRemaining - 1 };
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
		const window = this.#windowAt(now);
		if (window === undefined) {
			return 0;
		}

		const { predictedRemaining, resetAt } = window;
		if (predictedRemaining <= 0) {
			return Math.max(0, resetAt - now);
		}

		if (this.#lastAllowedAt === undefined) {
			return 0;
		}

		const interval = window.spacingMs ?? (resetAt - now) / predictedRemaining;
		return Math.max(0, this.#lastAllowedAt + interval - now);
	}

	/**
	 * The window in force at `now`, opening the next one at full capacity once
	 * the current window's reset has passed.
	 *
	 * @param now - The current time in ms.
	 * @returns The live window, or `undefined` while unprimed.
	 */
	#windowAt(now: number): undefined | WindowState {
		if (this.#window !== undefined && now >= this.#window.resetAt) {
			const { capacity, windowSeconds } = this.#rolloverWindow;
			const windowMs = windowSeconds * MS_PER_SECOND;
			this.#window = {
				predictedRemaining: capacity,
				resetAt: now + windowMs,
				spacingMs: windowMs / capacity,
			};
		}

		return this.#window;
	}
}
