import { OpenCloudError } from "./base.ts";

/**
 * Options for {@link PollTimeoutError}. The `T` type parameter captures the
 * resource-specific task variant the caller polled for; defaults to `unknown`
 * so the class can be reused by future Resources without forcing a parallel
 * hierarchy.
 *
 * @since 0.1.0
 *
 * @template T - Resource-specific task type being polled.
 */
export interface PollTimeoutErrorOptions<T = unknown> extends ErrorOptions {
	/** Last task observed before the timeout budget was exhausted. */
	readonly lastObservedTask?: T | undefined;
	/** Total wall-clock budget supplied by the caller, in ms. */
	readonly timeoutMs: number;
}

/**
 * Returned when `pollUntilDone` exhausts its wall-clock budget without
 * observing a terminal task state. Carries the last task polled so callers
 * can inspect state and decide whether to retry with a fresh budget.
 *
 * @since 0.1.0
 *
 * @template T - Resource-specific task type being polled.
 *
 * @example
 *
 * ```ts
 * import { PollTimeoutError } from "@bedrock-rbx/ocale";
 *
 * const error = new PollTimeoutError("polling timed out after 5 s", {
 *     lastObservedTask: { state: "PROCESSING" as const },
 *     timeoutMs: 5000,
 * });
 *
 * expect(error).toBeInstanceOf(PollTimeoutError);
 * expect(error.timeoutMs).toBe(5000);
 * expect(error.lastObservedTask).toStrictEqual({ state: "PROCESSING" });
 * ```
 */
export class PollTimeoutError<T = unknown> extends OpenCloudError {
	public readonly lastObservedTask: T | undefined;
	public override readonly name: string = "PollTimeoutError";
	public readonly timeoutMs: number;

	/**
	 * Creates a new PollTimeoutError.
	 *
	 * @param message - Human-readable description of the timeout.
	 * @param options - Error options including the budget and last-observed task.
	 */
	constructor(message: string, options: PollTimeoutErrorOptions<T>) {
		super(message, options);
		this.lastObservedTask = options.lastObservedTask;
		this.timeoutMs = options.timeoutMs;
	}
}
