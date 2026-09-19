import type { AdmissionWaitReason } from "../../client/types.ts";
import {
	type AbortableResult,
	ABORTED,
	raceWithAbortAsync,
	requestAbortedError,
} from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { type AdmissionContext, AdmissionWaitSpan } from "./admission-wait.ts";

/** Per-turn inputs to {@link AdmissionLine.sleepAsync}. */
interface LineSleepInputs {
	/** Optional caller cancellation signal. */
	readonly signal: AbortSignal | undefined;
	/** The sleeping request's span, handed to its turn by the line. */
	readonly span: AdmissionWaitSpan;
}

/**
 * One serialized admission line: an operation's token bucket, or one budget
 * scope's window. The line owns turn order, the cancellation race, and the
 * wait spans of every request queued on it, so its users supply only the
 * policy that decides how long a turn holds the line.
 *
 * Holding the line is what makes a request wait, so a request that sleeps
 * reports that wait for itself and for everyone queued behind it. Those
 * requests learn no duration: the schedule belongs to the request ahead of
 * them, and is not knowable until their own turn computes it.
 */
export class AdmissionLine {
	readonly #reason: AdmissionWaitReason;
	readonly #sleep: SleepFunc;
	readonly #unstarted = new Set<AdmissionWaitSpan>();

	#chain: Promise<void> = Promise.resolve();
	#sleeping = false;

	/**
	 * Creates an empty line.
	 *
	 * @param reason - Why a request held by this line is waiting.
	 * @param sleep - Injectable sleep (tests pass a fake).
	 */
	constructor(reason: AdmissionWaitReason, sleep: SleepFunc) {
		this.#reason = reason;
		this.#sleep = sleep;
	}

	/**
	 * Runs `turnAsync` once every earlier turn on this line has settled,
	 * whether it resolved or rejected, so one failed turn cannot poison the
	 * next caller's. The request's wait is reported for as long as the line
	 * holds it.
	 *
	 * @param turnAsync - The policy to run once the line is this request's,
	 *   called with the span it may sleep against.
	 * @param admission - The request's cancellation signal and wait observer.
	 * @rejects {@link RequestAbortedError} when the caller cancels while queued.
	 */
	public async admitAsync(
		turnAsync: (span: AdmissionWaitSpan) => Promise<void>,
		{ onAdmissionWait, signal }: AdmissionContext,
	): Promise<void> {
		const span = new AdmissionWaitSpan(onAdmissionWait, this.#reason);
		this.#unstarted.add(span);
		if (this.#sleeping) {
			// A request already sleeping on this line is what holds this one.
			this.#begin(span);
		}

		const myTurn = this.#chain.catch(ignoreRejection).then(async () => turnAsync(span));
		this.#chain = myTurn.catch(ignoreRejection);
		try {
			const turnResult = await raceWithAbortAsync(async () => myTurn, signal);
			if (turnResult === ABORTED) {
				throw requestAbortedError(signal);
			}
		} finally {
			this.#unstarted.delete(span);
			span.end();
		}
	}

	/**
	 * Holds the line asleep for `waitMs`, reporting the wait it names and the
	 * waits it imposes on every request queued behind it.
	 *
	 * @param waitMs - How long the turn holds the line.
	 * @param inputs - The turn's span and the caller's cancellation signal.
	 * @returns The sleep outcome, aborted when cancellation ends it first.
	 */
	public async sleepAsync(
		waitMs: number,
		{ signal, span }: LineSleepInputs,
	): Promise<AbortableResult<void>> {
		span.begin(waitMs);
		this.#unstarted.delete(span);
		for (const queued of this.#unstarted) {
			this.#begin(queued);
		}

		this.#sleeping = true;
		try {
			return await raceWithAbortAsync(async () => this.#sleep(waitMs, signal), signal);
		} finally {
			this.#sleeping = false;
		}
	}

	#begin(span: AdmissionWaitSpan): void {
		span.begin();
		this.#unstarted.delete(span);
	}
}

function ignoreRejection(): void {
	// A failed or cancelled turn must not poison the next caller's line.
}
