import { ABORTED, raceWithAbortAsync, requestAbortedError } from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { type AdmissionWaitContext, observeAdmissionWaitAsync } from "./admission-wait.ts";
import { BudgetTracker } from "./budget-tracker.ts";
import type { RateLimitSample } from "./rate-limit-sample.ts";

/**
 * Identifies the rate-limit bucket one request draws on: Roblox meters each
 * operation in its own per-API-key bucket.
 */
export interface BudgetScope {
	/** The effective API key the request authenticates with. */
	readonly apiKey: string;
	/** The operation the request belongs to. */
	readonly operationKey: string;
}

/**
 * Header-primed rate-limit gate shared across a client. Holds one
 * {@link BudgetTracker} per {@link BudgetScope}. Before each request the caller
 * gates on the request's scope (sleeping if that budget is spent), and after
 * each response folds the parsed sample back in, so a later call on the same
 * scope can head off a 429 the static per-operation token bucket cannot
 * foresee.
 *
 * Gating is serialized per scope through a promise chain so concurrent
 * requests on one scope cannot read the same budget and reserve the same slot;
 * each waits for the prior gate's reserve before computing its own.
 */
export class BudgetGate {
	readonly #chains = new Map<string, Promise<void>>();
	readonly #pendingGates = new Map<string, number>();
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
	 * or rejected, so one failed attempt cannot poison later gates on the
	 * scope.
	 *
	 * @param scope - The API key and operation to gate on.
	 * @param context - Request-local observer and cancellation signal.
	 * @rejects {@link RequestAbortedError} when the caller cancels while waiting.
	 */
	public async gateAsync(
		scope: BudgetScope,
		{ observer, signal }: AdmissionWaitContext = {},
	): Promise<void> {
		const key = scopeKey(scope);
		const pendingGates = this.#pendingGates.get(key) ?? 0;
		const waitsForEarlierGate = pendingGates > 0;
		this.#pendingGates.set(key, pendingGates + 1);
		const previous = this.#chains.get(key) ?? Promise.resolve();
		const recovered = previous.catch(ignoreRejection);
		const mine = recovered.then(async () => {
			return this.#gateOnce(key, {
				observer: waitsForEarlierGate ? undefined : observer,
				signal,
			});
		});
		const completed = mine.finally(() => {
			const remainingGates = (this.#pendingGates.get(key) ?? 1) - 1;
			this.#pendingGates.set(key, remainingGates);
		});
		this.#chains.set(key, completed.catch(ignoreRejection));
		if (waitsForEarlierGate) {
			await observeAdmissionWaitAsync({
				observer,
				reason: "reported-budget",
				waitAsync: async () => waitForGateAsync(completed, signal),
			});
		} else {
			await waitForGateAsync(completed, signal);
		}
	}

	/**
	 * Folds a response's parsed budget back onto the scope. A `undefined`
	 * sample (headers absent or non-numeric) is ignored, leaving the scope on
	 * static pacing.
	 *
	 * @param scope - The same scope passed to {@link gateAsync}.
	 * @param sample - Parsed sample, or `undefined` when none was reported.
	 */
	public observe(scope: BudgetScope, sample: RateLimitSample | undefined): void {
		if (sample === undefined) {
			return;
		}

		this.#tracker(scopeKey(scope)).observe(sample, Date.now());
	}

	async #gateOnce(key: string, { observer, signal }: AdmissionWaitContext): Promise<void> {
		if (signal?.aborted === true) {
			throw requestAbortedError(signal);
		}

		const tracker = this.#tracker(key);
		const waitMs = tracker.waitMs(Date.now());
		if (waitMs > 0) {
			await observeAdmissionWaitAsync({
				durationMs: waitMs,
				observer,
				reason: "reported-budget",
				waitAsync: async () => {
					const sleepResult = await raceWithAbortAsync(
						async () => this.#sleep(waitMs, signal),
						signal,
					);
					if (sleepResult === ABORTED) {
						throw requestAbortedError(signal);
					}
				},
			});
		}

		tracker.reserve(Date.now());
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

function ignoreRejection(): void {
	// A failed or cancelled gate must not poison the next caller's chain.
}

async function waitForGateAsync(
	gate: Promise<void>,
	signal: AbortSignal | undefined,
): Promise<void> {
	const gateResult = await raceWithAbortAsync(async () => gate, signal);
	if (gateResult === ABORTED) {
		throw requestAbortedError(signal);
	}
}

/**
 * Composes the map key one budget window is tracked under.
 *
 * @param scope - The API key and operation naming the window.
 * @returns The key for the tracker and chain maps.
 */
function scopeKey({ apiKey, operationKey }: BudgetScope): string {
	return `${apiKey}::${operationKey}`;
}
