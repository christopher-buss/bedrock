import { OpenCloudError, type OpenCloudErrorOptions } from "./base.ts";

/**
 * Options for constructing a {@link BadgeCostMismatchError}.
 *
 * @since unreleased
 */
export interface BadgeCostMismatchErrorOptions extends OpenCloudErrorOptions {
	/** The `expectedCost` the create sent, or `undefined` when it sent none. */
	readonly expectedCost: number | undefined;
	/** HTTP status code of the refusal. */
	readonly statusCode: number;
}

/**
 * Returned when Roblox refuses a badge create because its `expectedCost`
 * differs from what the badge would actually cost (body error code `18`).
 * Nothing is charged. A create sent with `expectedCost: 0` gets this once the
 * universe has used its free badge quota for the day. The upstream `ApiError`
 * is the `cause`.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { BadgeCostMismatchError } from "@bedrock-rbx/ocale";
 *
 * const error = new BadgeCostMismatchError(
 *     "Expected badge cost is different from the actual badge cost.",
 *     { code: "18", expectedCost: 0, statusCode: 403 },
 * );
 *
 * // A free create was refused: the free badge quota is spent for today.
 * expect(error.expectedCost).toBe(0);
 * expect(error.statusCode).toBe(403);
 * ```
 */
export class BadgeCostMismatchError extends OpenCloudError {
	public readonly expectedCost: number | undefined;
	public override readonly name: string = "BadgeCostMismatchError";
	public readonly statusCode: number;

	/**
	 * Creates a new BadgeCostMismatchError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including the cost the create expected
	 *   and the HTTP status of the refusal.
	 */
	constructor(message: string, options: BadgeCostMismatchErrorOptions) {
		super(message, options);
		this.expectedCost = options.expectedCost;
		this.statusCode = options.statusCode;
	}
}
