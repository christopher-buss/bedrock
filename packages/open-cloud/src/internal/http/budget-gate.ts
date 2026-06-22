import type { SleepFunc } from "../utils/sleep.ts";
import { BudgetTracker } from "./budget-tracker.ts";
import type { RateLimitSample } from "./rate-limit-sample.ts";

/**
 * Header-primed rate-limit gate shared across a client. Holds one
 * {@link BudgetTracker} per API key, since the tightest Roblox window is the
 * per-key one shared across every operation. Before each request the caller
 * gates on the request's key (sleeping if its budget is spent), and after each
 * response folds the parsed sample back in, so a sibling operation on the same
 * key can head off a 429 the static per-operation token bucket cannot foresee.
 * A per-operation tracker is deliberately not kept: every operation reports the
 * same most-constrained `remaining`, so a per-key tracker (drawn down by all
 * operations) is always the binding constraint.
 *
 * Gating is serialized per scope through a promise chain so concurrent
 * requests on one key cannot read the same budget and reserve the same slot;
 * each waits for the prior gate's reserve before computing its own.
 */
export class BudgetGate {
	readonly #chains = new Map<string, Promise<void>>();
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
	 * Holds until the scope's budget permits a send, then reserves one slot.
	 * Runs after the prior gate on the same scope settles, whether it resolved
	 * or rejected, so one failed attempt cannot poison later gates on the key.
	 *
	 * @param scope - The scope key to gate on (the effective API key).
	 */
	public async gate(scope: string): Promise<void> {
		const previous = this.#chains.get(scope) ?? Promise.resolve();
		const runGate = async (): Promise<void> => this.#gateOnce(scope);
		const mine = previous.then(runGate, runGate);
		this.#chains.set(scope, mine);
		await mine;
	}

	/**
	 * Folds a response's parsed budget back onto the scope. A `undefined`
	 * sample (headers absent or non-numeric) is ignored, leaving the scope on
	 * static pacing.
	 *
	 * @param scope - The same scope key passed to {@link gate}.
	 * @param sample - Parsed sample, or `undefined` when none was reported.
	 */
	public observe(scope: string, sample: RateLimitSample | undefined): void {
		if (sample === undefined) {
			return;
		}

		this.#tracker(scope).observe(sample, Date.now());
	}

	async #gateOnce(scope: string): Promise<void> {
		const tracker = this.#tracker(scope);
		const waitMs = tracker.waitMs(Date.now());
		if (waitMs > 0) {
			await this.#sleep(waitMs);
		}

		tracker.reserve(Date.now());
	}

	#tracker(scope: string): BudgetTracker {
		const existing = this.#trackers.get(scope);
		if (existing !== undefined) {
			return existing;
		}

		const tracker = new BudgetTracker();
		this.#trackers.set(scope, tracker);
		return tracker;
	}
}
