/**
 * Options for constructing an {@link OpenCloudError}.
 *
 * @since unreleased
 */
export interface OpenCloudErrorOptions extends ErrorOptions {
	/**
	 * Machine-readable classifier for the failure, when the error has one. An
	 * `ApiError` fills it from the response body; a `ValidationError` narrows
	 * it to its own closed union. Errors with nothing to classify (transport
	 * failures, rate limits, poll timeouts) leave it `undefined`.
	 */
	code?: string | undefined;
}

/**
 * Base error class for all Open Cloud SDK errors.
 *
 * All specific error types (RateLimitError, ApiError, NetworkError)
 * extend this class, enabling `instanceof OpenCloudError` checks.
 *
 * `code` is declared here rather than on the subclasses that populate it, so a
 * caller holding the `OpenCloudError` that `Result.err` is typed as can branch
 * on it without first narrowing to a subclass.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { ApiError, OpenCloudError } from "@bedrock-rbx/ocale";
 *
 * // `Result.err` is typed as OpenCloudError, so a caller draining a queue
 * // branches on the canonical status without narrowing to a subclass first.
 * const err: OpenCloudError = new ApiError("HTTP 404: Queue items not found.", {
 *     code: "NOT_FOUND",
 *     statusCode: 404,
 * });
 *
 * expect(err.code).toBe("NOT_FOUND");
 * expect(new OpenCloudError("no classifier").code).toBeUndefined();
 * ```
 */
export class OpenCloudError extends Error {
	/** Machine-readable classifier, or `undefined` when the error has none. */
	public readonly code: string | undefined;
	public override readonly name: string = "OpenCloudError";

	/**
	 * Creates a new OpenCloudError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including the optional `cause` and the
	 *   machine-readable `code`.
	 */
	constructor(message?: string, options?: OpenCloudErrorOptions) {
		super(message, options);
		this.code = options?.code;
	}
}
