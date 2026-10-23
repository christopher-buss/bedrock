import type { OpenCloudError } from "../../errors/base.ts";
import { RateLimitWaitRefusedError } from "../../errors/rate-limit-wait-refused.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import type { Result } from "../../types.ts";
import { ABORTED, raceWithAbortAsync, requestAbortedError } from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { type AdmissionWaitContext, observeAdmissionWaitAsync } from "./admission-wait.ts";
import { type BudgetReservation, BudgetTracker } from "./budget-tracker.ts";
import type { RateLimitSample, RateLimitWindow } from "./rate-limit-sample.ts";
import { waitDeadlineFailure } from "./request-deadline.ts";

const REPORTED_BUDGET_REASON = "reported-budget";
const MS_PER_SECOND = 1000;

/**
 * Identifies the rate-limit bucket one request draws on: Roblox meters each
 * operation in its own per-credential bucket.
 */
export interface BudgetScope {
	/** The effective credential's queue key, namespaced by kind. */
	readonly credentialKey: string;
	/**
	 * The operation's documented capacity, admitted per window once a reset
	 * passes before any response has reported the real one.
	 */
	readonly documentedWindow: RateLimitWindow;
	/** The operation the request belongs to. */
	readonly operationKey: string;
}

/** A refused long 429 and the instant its scope may send again. */
interface Lockout {
	readonly cause: RateLimitError;
	readonly resetAt: number;
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
	readonly #lockouts = new Map<string, Lockout>();
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
	 * @param scope - The credential and operation to gate on.
	 * @param context - Request-local observer and cancellation signal.
	 * @returns The reserved slot. Release it when the request is not sent.
	 * @rejects {@link RequestAbortedError} when the caller cancels while waiting.
	 * @rejects {@link RateLimitWaitRefusedError} while the scope is locked out.
	 */
	public async gateAsync(
		scope: BudgetScope,
		{ deadlineMs, observer, signal }: AdmissionWaitContext = {},
	): Promise<BudgetReservation> {
		const key = scopeKey(scope);
		const pendingGates = this.#pendingGates.get(key) ?? 0;
		const waitsForEarlierGate = pendingGates > 0;
		this.#pendingGates.set(key, pendingGates + 1);
		const previous = this.#chains.get(key) ?? Promise.resolve();
		const recovered = previous.catch(ignoreRejection);
		const mine = recovered.then(async () => {
			return this.#gateOnce(scope, {
				deadlineMs,
				observer: waitsForEarlierGate ? undefined : observer,
				signal,
			});
		});
		const completed = mine.finally(() => {
			const remainingGates = (this.#pendingGates.get(key) ?? 1) - 1;
			this.#pendingGates.set(key, remainingGates);
		});
		this.#chains.set(key, completed.then(ignoreRejection).catch(ignoreRejection));
		if (waitsForEarlierGate) {
			return observeAdmissionWaitAsync({
				observer,
				reason: REPORTED_BUDGET_REASON,
				waitAsync: async () => waitForGateAsync(completed, signal),
			});
		}

		return waitForGateAsync(completed, signal);
	}

	/**
	 * Locks the scope out until the refused 429's guided wait ends. Until then
	 * every gate on the scope is refused at once, without sleeping or
	 * reserving budget. The latest lockout replaces any earlier one.
	 *
	 * @param scope - The same scope passed to {@link gateAsync}.
	 * @param cause - The 429 whose guided wait was too long to take.
	 */
	public lockOut(scope: BudgetScope, cause: RateLimitError): void {
		this.#lockouts.set(scopeKey(scope), {
			cause,
			resetAt: Date.now() + cause.retryAfterSeconds * MS_PER_SECOND,
		});
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

		this.#tracker(scopeKey(scope), scope.documentedWindow).observe(sample, Date.now());
	}

	/**
	 * Refuses a request at once while its scope is locked out, so it fails
	 * before taking a static queue slot or waiting on anything.
	 *
	 * @param scope - The same scope passed to {@link gateAsync}.
	 * @throws {@link RateLimitWaitRefusedError} While the scope is locked out.
	 */
	public refuseDuringLockout(scope: BudgetScope): void {
		this.#refuseDuringLockout(scopeKey(scope));
	}

	/**
	 * Swaps a request's result for the lockout refusal while its scope is
	 * locked out, for a lockout that began after the request passed its gate.
	 *
	 * @param scope - The same scope passed to {@link gateAsync}.
	 * @param result - The request's result so far.
	 * @returns The refusal while the scope is locked out, else `result`.
	 */
	public refuseIfLockedOut<T>(
		scope: BudgetScope,
		result: Result<T, OpenCloudError>,
	): Result<T, OpenCloudError> {
		const refusal = this.#lockoutRefusal(scopeKey(scope));
		return refusal === undefined ? result : { err: refusal, success: false };
	}

	async #gateOnce(
		scope: BudgetScope,
		{ deadlineMs, observer, signal }: AdmissionWaitContext,
	): Promise<BudgetReservation> {
		if (signal?.aborted === true) {
			throw requestAbortedError(signal);
		}

		const key = scopeKey(scope);
		const tracker = this.#tracker(key, scope.documentedWindow);

		this.#refuseDuringLockout(key);
		const waitMs = tracker.waitMs(Date.now());
		if (waitMs > 0) {
			await this.#waitAsync(waitMs, { deadlineMs, observer, signal });
			this.#refuseDuringLockout(key);
		}

		return tracker.reserve(Date.now());
	}

	#lockoutRefusal(key: string): RateLimitWaitRefusedError | undefined {
		const lockout = this.#lockouts.get(key);
		const now = Date.now();
		return lockout !== undefined && now < lockout.resetAt
			? lockoutRefusal(lockout, now)
			: undefined;
	}

	#refuseDuringLockout(key: string): void {
		const refusal = this.#lockoutRefusal(key);
		if (refusal !== undefined) {
			throw refusal;
		}
	}

	#tracker(key: string, documentedWindow: RateLimitWindow): BudgetTracker {
		const existing = this.#trackers.get(key);
		if (existing !== undefined) {
			return existing;
		}

		const tracker = new BudgetTracker(documentedWindow);
		this.#trackers.set(key, tracker);
		return tracker;
	}

	async #waitAsync(
		waitMs: number,
		{ deadlineMs, observer, signal }: AdmissionWaitContext,
	): Promise<void> {
		const refusal = waitDeadlineFailure({
			deadlineMs,
			waitMs,
			waitReason: REPORTED_BUDGET_REASON,
		});
		if (refusal !== undefined) {
			throw refusal;
		}

		await observeAdmissionWaitAsync({
			durationMs: waitMs,
			observer,
			reason: REPORTED_BUDGET_REASON,
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
}

/**
 * Composes the map key one credential and operation are tracked under. The
 * budget gate and the rate-limit queues share it.
 *
 * @param scope - The credential key and operation naming the window.
 * @returns The key for the tracker, chain and queue maps.
 */
export function scopeKey({
	credentialKey,
	operationKey,
}: Pick<BudgetScope, "credentialKey" | "operationKey">): string {
	return `${credentialKey}::${operationKey}`;
}

function lockoutRefusal({ cause, resetAt }: Lockout, now: number): RateLimitWaitRefusedError {
	const secondsLeft = Math.ceil((resetAt - now) / MS_PER_SECOND);
	const remainingLockout = new RateLimitError(cause.message, {
		cause,
		code: cause.code,
		details: cause.details,
		remaining: cause.remaining,
		responseHeaders: cause.responseHeaders,
		retryAfterSeconds: secondsLeft,
		source: cause.source,
		statusCode: cause.statusCode,
	});
	return new RateLimitWaitRefusedError(
		`Rate limit lockout on this operation lasts another ${secondsLeft}s; request not sent`,
		{ cause: remainingLockout },
	);
}

function ignoreRejection(): void {
	// A failed or cancelled gate must not poison the next caller's chain.
}

async function waitForGateAsync(
	gate: Promise<BudgetReservation>,
	signal: AbortSignal | undefined,
): Promise<BudgetReservation> {
	const gateResult = await raceWithAbortAsync(async () => gate, signal);
	if (gateResult === ABORTED) {
		throw requestAbortedError(signal);
	}

	return gateResult;
}
