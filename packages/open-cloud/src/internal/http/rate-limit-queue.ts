import { ABORTED, raceWithAbortAsync, requestAbortedError } from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { type AdmissionContext, AdmissionWaitSpan } from "./admission-wait.ts";
import type { OpenCloudHooks } from "./types.ts";

/**
 * Identifies and bounds a single Roblox Open Cloud operation for rate
 * limiting, e.g. `{ operationKey: "game-passes.create", maxPerSecond: 5 }`.
 */
export interface OperationLimit {
	/**
	 * How many requests may be issued back to back before pacing begins,
	 * as a whole number of requests. Defaults to `max(1, maxPerSecond)`,
	 * which leaves operations at or above 1/s paced exactly as their
	 * sustained rate allows while still granting a slower operation one
	 * request after it has idled. Set this to the allowance the schema
	 * documents (e.g. 5 per minute) to grant the burst the server permits.
	 */
	readonly burstCapacity?: number;
	/** Maximum sustained request rate in requests per second. */
	readonly maxPerSecond: number;
	/**
	 * Stable identifier for the operation (e.g. "game-passes.create"). Not
	 * consumed by the queue itself; callers use it to key per-operation
	 * queues in a registry (see GamePassesClient).
	 */
	readonly operationKey: string;
}

/**
 * Token-bucket rate limiter for a single `(apiKey, operation)` pair. Every
 * call to `acquire` consumes one token; when the bucket is empty the call
 * waits until a token regenerates before invoking the task. Tokens refill at
 * `maxPerSecond` per second, up to the operation's `burstCapacity`.
 *
 * Implemented as a leaky bucket tracking drain debt in ms. `#lastCheck`
 * advances by `waitMs` after every sleep so the algorithm stays correct
 * whether or not the injected sleep moves `Date.now()` forward. `#bucketLevel`
 * and `#maxBucketLevel` are both ms of drain debt, so the ceiling is the burst
 * expressed in that unit: `burstCapacity` refill intervals. Deriving it any
 * other way (notably `maxPerSecond * intervalMs`, whose units cancel to a
 * constant 1000) starves every operation slower than one request per second.
 */
export class RateLimitQueue {
	readonly #held = new Set<AdmissionWaitSpan>();
	readonly #hooks: OpenCloudHooks;
	readonly #intervalMs: number;
	readonly #maxBucketLevel: number;
	readonly #sleep: SleepFunc;

	#bucketLevel = 0;
	#chain: Promise<void> = Promise.resolve();
	#lastCheck: number = Date.now();
	#sleeping = 0;

	/**
	 * Creates a rate-limit queue bound to a single operation.
	 *
	 * @param limit - The operation key and its per-second request ceiling.
	 * @param hooks - Observability callbacks; `onRateLimit` fires when the
	 *   bucket is empty and a sleep is about to start.
	 * @param sleep - Injectable sleep (tests pass a fake).
	 */
	constructor(limit: OperationLimit, hooks: OpenCloudHooks, sleep: SleepFunc) {
		this.#intervalMs = 1000 / limit.maxPerSecond;
		const burstCapacity = limit.burstCapacity ?? Math.max(1, limit.maxPerSecond);
		this.#maxBucketLevel = burstCapacity * this.#intervalMs;
		this.#hooks = hooks;
		this.#sleep = sleep;
	}

	/**
	 * Waits for a token — sleeping and firing `hooks.onRateLimit` if the
	 * bucket is empty — then executes `task`. Concurrent callers are
	 * serialized at token acquisition; tasks themselves run independently
	 * once their token is secured.
	 *
	 * @param task - The request to run once a token is available.
	 * @param admission - The request's cancellation signal and wait observer.
	 * @returns The value produced by `task`.
	 * @rejects {@link RequestAbortedError} when the caller cancels while queued.
	 */
	public async acquireAsync<T>(
		task: () => Promise<T>,
		{ onAdmissionWait, signal }: AdmissionContext = {},
	): Promise<T> {
		const span = new AdmissionWaitSpan(onAdmissionWait, "operation-queue");
		this.#held.add(span);
		if (this.#sleeping > 0) {
			// A request already sleeping for its token is what holds this one.
			span.begin();
		}

		const waitForTokenAsync = async (): Promise<void> => this.#waitForToken(signal, span);
		const myTurn = this.#chain.catch(ignoreRejection).then(waitForTokenAsync);
		this.#chain = myTurn.catch(ignoreRejection);
		try {
			const turnResult = await raceWithAbortAsync(async () => myTurn, signal);
			if (turnResult === ABORTED) {
				throw requestAbortedError(signal);
			}
		} finally {
			this.#held.delete(span);
			span.end();
		}

		return task();
	}

	async #sleepingAsync(
		waitMs: number,
		signal: AbortSignal | undefined,
	): Promise<typeof ABORTED | void> {
		this.#sleeping += 1;
		try {
			return await raceWithAbortAsync(async () => this.#sleep(waitMs, signal), signal);
		} finally {
			this.#sleeping -= 1;
		}
	}

	async #waitForToken(signal: AbortSignal | undefined, span: AdmissionWaitSpan): Promise<void> {
		if (signal?.aborted === true) {
			throw requestAbortedError(signal);
		}

		const now = Math.max(Date.now(), this.#lastCheck);
		const drained = Math.max(0, this.#bucketLevel - (now - this.#lastCheck));
		this.#lastCheck = now;

		if (drained + this.#intervalMs <= this.#maxBucketLevel) {
			this.#bucketLevel = drained + this.#intervalMs;
			return;
		}

		const waitMs = drained + this.#intervalMs - this.#maxBucketLevel;
		this.#hooks.onRateLimit?.(waitMs);
		span.begin(waitMs);
		for (const held of this.#held) {
			// Every request behind this one waits for the same sleep, on a
			// schedule none of them can name.
			held.begin();
		}

		const sleepResult = await this.#sleepingAsync(waitMs, signal);
		if (sleepResult === ABORTED) {
			throw requestAbortedError(signal);
		}

		this.#bucketLevel = this.#maxBucketLevel;
		this.#lastCheck = now + waitMs;
	}
}

function ignoreRejection(): void {
	// A failed or cancelled acquire must not poison the next caller's chain.
}
