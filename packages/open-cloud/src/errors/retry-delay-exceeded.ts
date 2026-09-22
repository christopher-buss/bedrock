import { RequestDeadlineExceededError } from "./request-deadline-exceeded.ts";

/**
 * Options for constructing a {@link RetryDelayExceededError}.
 *
 * @since 0.3.2
 */
export interface RetryDelayExceededErrorOptions extends ErrorOptions {
	/** Absolute caller-supplied deadline, as Unix epoch milliseconds. */
	readonly deadlineMs: number;
	/** Time left when the SDK refused the retry delay. */
	readonly remainingMs: number;
	/** Computed retry delay that could not fit before the deadline. */
	readonly retryAfterMs: number;
}

/**
 * Returned when the SDK refuses a retry delay that cannot complete before the
 * request deadline. This is distinct from cancellation so consumers can
 * report the server's stated retry time without waiting for it.
 *
 * @since 0.3.2
 *
 * @example
 *
 * ```ts
 * import { RetryDelayExceededError } from "@bedrock-rbx/ocale";
 *
 * const error = new RetryDelayExceededError("Retry delay exceeds the request deadline", {
 *     deadlineMs: 1_000_000,
 *     remainingMs: 495_000,
 *     retryAfterMs: 1_856_000,
 * });
 *
 * expect(error.retryAfterMs).toBe(1_856_000);
 * expect(error.remainingMs).toBe(495_000);
 * ```
 */
export class RetryDelayExceededError extends RequestDeadlineExceededError {
	public override readonly name: string = "RetryDelayExceededError";
	/** Computed retry delay refused by the SDK, in milliseconds. */
	public readonly retryAfterMs: number;
	/** Computed retry delay refused by the SDK, in seconds. */
	public readonly retryAfterSeconds: number;

	/**
	 * Creates a new RetryDelayExceededError.
	 *
	 * @param message - Human-readable description of the refused retry delay.
	 * @param options - Refused delay, deadline budget, and original failure.
	 */
	constructor(message: string, options: RetryDelayExceededErrorOptions) {
		super(message, {
			...options,
			waitMs: options.retryAfterMs,
			waitReason: "retry-delay",
		});
		this.retryAfterMs = options.retryAfterMs;
		this.retryAfterSeconds = options.retryAfterMs / 1000;
	}
}
