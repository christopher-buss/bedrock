import { ABORTED, raceWithAbortAsync, requestAbortedError } from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { AdmissionLine } from "./admission-line.ts";
import { type AdmissionContext, AdmissionWaitSpan } from "./admission-wait.ts";
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

/** Per-request inputs one gated turn needs beyond its scope key. */
interface GateOnceInputs {
	/** The scope's admission line, holding every request queued on it. */
	readonly line: AdmissionLine;
	/** Optional caller cancellation signal. */
	readonly signal: AbortSignal | undefined;
	/** The request's budget-wait span, begun when the gate sleeps. */
	readonly span: AdmissionWaitSpan;
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
	readonly #lines = new Map<string, AdmissionLine>();
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
	 * @param admission - The request's cancellation signal and wait observer.
	 * @rejects {@link RequestAbortedError} when the caller cancels while waiting.
	 */
	public async gateAsync(
		scope: BudgetScope,
		{ onAdmissionWait, signal }: AdmissionContext = {},
	): Promise<void> {
		const key = scopeKey(scope);
		const span = new AdmissionWaitSpan(onAdmissionWait, "reported-budget");
		const line = this.#line(key);
		line.join(span);
		const previous = this.#chains.get(key) ?? Promise.resolve();
		const recovered = previous.catch(ignoreRejection);
		const mine = recovered.then(async () => this.#gateOnce(key, { line, signal, span }));
		this.#chains.set(key, mine.catch(ignoreRejection));
		try {
			const gateResult = await raceWithAbortAsync(async () => mine, signal);
			if (gateResult === ABORTED) {
				throw requestAbortedError(signal);
			}
		} finally {
			line.leave(span);
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

	async #gateOnce(key: string, { line, signal, span }: GateOnceInputs): Promise<void> {
		if (signal?.aborted === true) {
			throw requestAbortedError(signal);
		}

		const tracker = this.#tracker(key);
		const waitMs = tracker.waitMs(Date.now());
		if (waitMs > 0) {
			const sleepResult = await line.holdAsync(
				async () => raceWithAbortAsync(async () => this.#sleep(waitMs, signal), signal),
				{ span, waitMs },
			);
			if (sleepResult === ABORTED) {
				throw requestAbortedError(signal);
			}
		}

		tracker.reserve(Date.now());
	}

	#line(key: string): AdmissionLine {
		const existing = this.#lines.get(key);
		if (existing !== undefined) {
			return existing;
		}

		const line = new AdmissionLine();
		this.#lines.set(key, line);
		return line;
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

/**
 * Composes the map key one budget window is tracked under.
 *
 * @param scope - The API key and operation naming the window.
 * @returns The key for the tracker and chain maps.
 */
function scopeKey({ apiKey, operationKey }: BudgetScope): string {
	return `${apiKey}::${operationKey}`;
}
