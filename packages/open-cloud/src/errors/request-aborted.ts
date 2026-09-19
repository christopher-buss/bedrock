import { OpenCloudError } from "./base.ts";

/**
 * Options for constructing a {@link RequestAbortedError}.
 *
 * @since unreleased
 */
export interface RequestAbortedErrorOptions extends ErrorOptions {
	/** Whatever `AbortSignal.reason` was at the moment of cancellation. */
	readonly reason?: unknown;
}

/**
 * Returned when a caller's `AbortSignal` cancels an Open Cloud request.
 * The reason is preserved so intentional cancellation can be distinguished
 * from transport failures and SDK-owned request timeouts.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { RequestAbortedError } from "@bedrock-rbx/ocale";
 *
 * const error = new RequestAbortedError("Request was aborted", {
 *     reason: "superseded",
 * });
 *
 * expect(error).toBeInstanceOf(RequestAbortedError);
 * expect(error.reason).toBe("superseded");
 * ```
 */
export class RequestAbortedError extends OpenCloudError {
	public override readonly name: string = "RequestAbortedError";
	public readonly reason?: unknown;

	/**
	 * Creates a new RequestAbortedError.
	 *
	 * @param message - Human-readable description of the cancellation.
	 * @param options - Error options including the caller's abort reason.
	 */
	constructor(message: string, options: RequestAbortedErrorOptions = {}) {
		super(message, options);
		this.reason = options.reason;
	}
}
