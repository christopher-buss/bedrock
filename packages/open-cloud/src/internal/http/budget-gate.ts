import { ABORTED, requestAbortedError } from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { AdmissionLine } from "./admission-line.ts";
import type { AdmissionContext, AdmissionWaitSpan } from "./admission-wait.ts";
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

/** Per-request inputs one gated turn needs beyond its scope's state. */
interface GateOnceInputs {
	/** Optional caller cancellation signal. */
	readonly signal: AbortSignal | undefined;
	/** The request's budget-wait span, handed to its turn by the line. */
	readonly span: AdmissionWaitSpan;
}

/** Everything one budget scope is paced by: its queue and its window. */
interface ScopeState {
	/** Serializes gating on the scope and reports the waits it imposes. */
	readonly line: AdmissionLine;
	/** The scope's live view of the budget Roblox reported. */
	readonly tracker: BudgetTracker;
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
	readonly #scopes = new Map<string, ScopeState>();
	readonly #sleep: SleepFunc;

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
	 * @param admission - The request's cancellation signal and wait observer.
	 * @rejects {@link RequestAbortedError} when the caller cancels while waiting.
	 */
	public async gateAsync(scope: BudgetScope, admission: AdmissionContext = {}): Promise<void> {
		const state = this.#scope(scopeKey(scope));
		await state.line.admitAsync(
			async (span) => this.#gateOnce(state, { signal: admission.signal, span }),
			admission,
		);
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

		this.#scope(scopeKey(scope)).tracker.observe(sample, Date.now());
	}

	async #gateOnce(
		{ line, tracker }: ScopeState,
		{ signal, span }: GateOnceInputs,
	): Promise<void> {
		if (signal?.aborted === true) {
			throw requestAbortedError(signal);
		}

		const waitMs = tracker.waitMs(Date.now());
		if (waitMs > 0) {
			const sleepResult = await line.sleepAsync(waitMs, { signal, span });
			if (sleepResult === ABORTED) {
				throw requestAbortedError(signal);
			}
		}

		tracker.reserve(Date.now());
	}

	#scope(key: string): ScopeState {
		const existing = this.#scopes.get(key);
		if (existing !== undefined) {
			return existing;
		}

		const state: ScopeState = {
			line: new AdmissionLine("reported-budget", this.#sleep),
			tracker: new BudgetTracker(),
		};
		this.#scopes.set(key, state);
		return state;
	}
}

/**
 * Composes the map key one budget window is tracked under.
 *
 * @param scope - The API key and operation naming the window.
 * @returns The key the scope's state is held under.
 */
function scopeKey({ apiKey, operationKey }: BudgetScope): string {
	return `${apiKey}::${operationKey}`;
}
