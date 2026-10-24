/**
 * Options for constructing an {@link OpenCloudError}.
 *
 * @since 0.3.0
 */
export interface OpenCloudErrorOptions extends ErrorOptions {
	/**
	 * Machine-readable classifier for the failure, when the error has one. An
	 * `ApiError` and `RateLimitError` fill it from the response body; a
	 * `ValidationError` narrows it to its own closed union. Errors with nothing
	 * to classify (transport failures and poll timeouts) leave it `undefined`.
	 */
	readonly code?: string | undefined;
}

const NO_PREVIOUS_ATTEMPTS: ReadonlyArray<OpenCloudError> = Object.freeze([]);

const PREVIOUS_ATTEMPTS = new WeakMap<OpenCloudError, ReadonlyArray<OpenCloudError>>();

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

	/**
	 * Failures of the earlier attempts of the same logical request, oldest
	 * first. A failure that is this error's own `cause` is not repeated here.
	 * Empty when the request was not retried.
	 *
	 * @since unreleased
	 * @returns The earlier attempts' failures.
	 */
	public get previousAttempts(): ReadonlyArray<OpenCloudError> {
		return PREVIOUS_ATTEMPTS.get(this) ?? NO_PREVIOUS_ATTEMPTS;
	}
}

/**
 * Records the failures of the earlier attempts of the logical request that
 * produced `error`, so they read back through
 * {@link OpenCloudError.previousAttempts}.
 *
 * @param error - The failure the retry loop returns.
 * @param attempts - Earlier attempt failures, oldest first.
 * @returns The same error.
 */
export function recordPreviousAttempts(
	error: OpenCloudError,
	attempts: ReadonlyArray<OpenCloudError>,
): OpenCloudError {
	PREVIOUS_ATTEMPTS.set(error, Object.freeze([...attempts]));
	return error;
}
