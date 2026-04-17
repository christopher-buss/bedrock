import type { SleepFunc } from "../utils/sleep.ts";
import type { OpenCloudHooks } from "./types.ts";

/**
 * Identifies and bounds a single Roblox Open Cloud operation for rate
 * limiting, e.g. `{ operationKey: "game-passes.create", maxPerSecond: 5 }`.
 */
export interface OperationLimit {
	/** Maximum sustained request rate in requests per second. */
	readonly maxPerSecond: number;
	/** Stable identifier for the operation (e.g. "game-passes.create"). */
	readonly operationKey: string;
}

/**
 * Token-bucket rate limiter for a single `(apiKey, operation)` pair. Every
 * call to `acquire` consumes one token; when the bucket is empty the call
 * waits until a token regenerates before invoking the task. Burst capacity
 * equals `maxPerSecond`, refilling at `maxPerSecond` tokens per second.
 *
 * Implemented as a leaky bucket tracking drain debt in ms. `#lastCheck`
 * advances by `waitMs` after every sleep so the algorithm stays correct
 * whether or not the injected sleep moves `Date.now()` forward.
 */
export class RateLimitQueue {
	readonly #hooks: OpenCloudHooks;
	readonly #intervalMs: number;
	readonly #maxBucketLevel: number;
	readonly #sleep: SleepFunc;

	#bucketLevel = 0;
	#chain: Promise<void> = Promise.resolve();
	#lastCheck: number = Date.now();

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
		this.#maxBucketLevel = limit.maxPerSecond * this.#intervalMs;
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
	 * @returns The value produced by `task`.
	 */
	public async acquire<T>(task: () => Promise<T>): Promise<T> {
		const myTurn = this.#chain.then(async () => this.#waitForToken());
		this.#chain = myTurn;
		await myTurn;
		return task();
	}

	async #waitForToken(): Promise<void> {
		const now = Math.max(Date.now(), this.#lastCheck);
		const drained = Math.max(0, this.#bucketLevel - (now - this.#lastCheck));
		this.#lastCheck = now;

		if (drained + this.#intervalMs <= this.#maxBucketLevel) {
			this.#bucketLevel = drained + this.#intervalMs;
			return;
		}

		const waitMs = drained + this.#intervalMs - this.#maxBucketLevel;
		this.#hooks.onRateLimit?.(waitMs);
		await this.#sleep(waitMs);
		this.#bucketLevel = this.#maxBucketLevel;
		this.#lastCheck = now + waitMs;
	}
}
