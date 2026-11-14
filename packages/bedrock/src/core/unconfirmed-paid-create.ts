import { ApiError, requestContextOf } from "@bedrock-rbx/ocale";

/**
 * What a user does after a paid create that may have completed and charged.
 */
export const UNCONFIRMED_REMEDY =
	"Check the universe badges and the Robux transactions before you deploy again";

/**
 * A server error (`5xx`) in answer to a paid badge create. Roblox may have
 * created the badge and charged for it all the same, so bedrock does not
 * treat the create as deferred and sends no further paid create in the
 * Deploy. Carries the original response unchanged, with the original
 * {@link ApiError} as its `cause`.
 *
 * @since 0.5.0
 *
 * @example
 *
 * ```ts
 * import { ApiError } from "@bedrock-rbx/ocale";
 * import { UnconfirmedPaidCreateError } from "@bedrock-rbx/core";
 *
 * const original = new ApiError("HTTP 500", { statusCode: 500 });
 * const err = new UnconfirmedPaidCreateError(original, 100);
 *
 * expect(err).toBeInstanceOf(ApiError);
 * expect(err.name).toBe("UnconfirmedPaidCreateError");
 * expect(err.statusCode).toBe(500);
 * expect(err.expectedCost).toBe(100);
 * expect(err.cause).toBe(original);
 * ```
 */
export class UnconfirmedPaidCreateError extends ApiError {
	/** The Robux the paid create offered, and may have been charged. */
	public readonly expectedCost: number;
	public override readonly name: string = "UnconfirmedPaidCreateError";

	/**
	 * Wraps the server error that answered a paid create.
	 *
	 * @param original - The server error.
	 * @param expectedCost - The Robux the paid create offered.
	 */
	constructor(original: ApiError, expectedCost: number) {
		super(original.message, {
			...requestContextOf(original),
			cause: original,
			code: original.code,
			details: original.details,
			statusCode: original.statusCode,
		});
		this.expectedCost = expectedCost;
	}
}
