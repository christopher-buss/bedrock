import { OpenCloudError } from "./base.ts";

/**
 * Options for constructing a {@link PollAbortedError}.
 *
 * @since 0.1.0
 */
export interface PollAbortedErrorOptions extends ErrorOptions {
	/** Whatever `AbortSignal.reason` was at the moment of abort. */
	readonly reason?: unknown;
}

/**
 * Returned when `pollUntilDone` is interrupted by an `AbortSignal` before
 * a terminal task state is reached. The `reason` field mirrors
 * `AbortSignal.reason` so callers can distinguish intentional cancellation
 * from unexpected abort sources.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { PollAbortedError } from "@bedrock-rbx/ocale";
 *
 * const error = new PollAbortedError("polling was aborted", {
 *     reason: "user cancelled",
 * });
 *
 * expect(error).toBeInstanceOf(PollAbortedError);
 * expect(error.reason).toBe("user cancelled");
 * ```
 */
export class PollAbortedError extends OpenCloudError {
	public override readonly name: string = "PollAbortedError";
	public readonly reason?: unknown;

	/**
	 * Creates a new PollAbortedError.
	 *
	 * @param message - Human-readable description of the abort.
	 * @param options - Error options including the abort reason.
	 */
	constructor(message: string, options: PollAbortedErrorOptions = {}) {
		super(message, options);
		this.reason = options.reason;
	}
}
