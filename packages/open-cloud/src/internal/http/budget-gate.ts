import type { SleepFunc } from "../utils/sleep.ts";
import { BudgetTracker } from "./budget-tracker.ts";
import type { RateLimitSample } from "./rate-limit-sample.ts";

/**
 * Header-primed rate-limit gate shared across a client. Holds one
 * {@link BudgetTracker} per scope key (per-operation and per-API-key). Before
 * each request the caller gates on the relevant scope keys — sleeping if any is
 * exhausted — and after each response folds the parsed sample back onto those
 * keys. Prevents 429s the static token bucket cannot foresee, notably the
 * per-key window shared across operations.
 */
export class BudgetGate {
	readonly #sleep: SleepFunc;
	readonly #trackers = new Map<string, BudgetTracker>();

	/**
	 * Creates a gate bound to an injectable sleep.
	 *
	 * @param sleep - Injectable sleep (tests pass a fake clock).
	 */
	constructor(sleep: SleepFunc) {
		this.#sleep = sleep;
	}

	/**
	 * Holds until every scope key permits a send, then reserves one slot on
	 * each. The wait is the longest across keys, so the most-constrained window
	 * governs.
	 *
	 * @param keys - Scope keys to gate on (e.g. The API key and operation key).
	 */
	public async gate(keys: ReadonlyArray<string>): Promise<void> {
		const now = Date.now();
		let waitMs = 0;
		for (const key of keys) {
			waitMs = Math.max(waitMs, this.#tracker(key).waitMs(now));
		}

		if (waitMs > 0) {
			await this.#sleep(waitMs);
		}

		for (const key of keys) {
			this.#tracker(key).reserve();
		}
	}

	/**
	 * Folds a response's parsed budget back onto each scope key. A `undefined`
	 * sample (headers absent or non-numeric) is ignored, leaving the gate on
	 * static pacing for that scope.
	 *
	 * @param keys - The same scope keys passed to {@link gate}.
	 * @param sample - Parsed sample, or `undefined` when none was reported.
	 */
	public observe(keys: ReadonlyArray<string>, sample: RateLimitSample | undefined): void {
		if (sample === undefined) {
			return;
		}

		const now = Date.now();
		for (const key of keys) {
			this.#tracker(key).observe(sample, now);
		}
	}

	#tracker(key: string): BudgetTracker {
		const existing = this.#trackers.get(key);
		if (existing !== undefined) {
			return existing;
		}

		const tracker = new BudgetTracker();
		this.#trackers.set(key, tracker);
		return tracker;
	}
}
