import { OpenCloudError, type OpenCloudErrorOptions } from "./base.ts";

/**
 * Options for constructing a {@link BadgeInsufficientFundsError}.
 *
 * @since unreleased
 */
export interface BadgeInsufficientFundsErrorOptions extends OpenCloudErrorOptions {
	/** HTTP status code of the refusal. */
	readonly statusCode: number;
}

/**
 * Returned when Roblox refuses a badge create because the payer does not have
 * enough Robux to pay for it (body error code `17`). The upstream `ApiError`
 * is the `cause`.
 *
 * @since unreleased
 */
export class BadgeInsufficientFundsError extends OpenCloudError {
	public override readonly name: string = "BadgeInsufficientFundsError";
	public readonly statusCode: number;

	/**
	 * Creates a new BadgeInsufficientFundsError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including the HTTP status of the refusal.
	 */
	constructor(message: string, options: BadgeInsufficientFundsErrorOptions) {
		super(message, options);
		this.statusCode = options.statusCode;
	}
}
