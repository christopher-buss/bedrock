import { OpenCloudError, type OpenCloudErrorOptions } from "./base.ts";

/**
 * Options for constructing a {@link BadgeGroupSpendPermissionError}.
 *
 * @since 0.5.0
 */
export interface BadgeGroupSpendPermissionErrorOptions extends OpenCloudErrorOptions {
	/** HTTP status code of the refusal. */
	readonly statusCode: number;
}

/**
 * Returned when Roblox refuses a badge create paid from group funds because
 * the API key owner may not spend that group's funds (body error code `28`).
 * The fix is a group role with permission to spend group funds. The upstream
 * `ApiError` is the `cause`.
 *
 * @since 0.5.0
 */
export class BadgeGroupSpendPermissionError extends OpenCloudError {
	public override readonly name: string = "BadgeGroupSpendPermissionError";
	public readonly statusCode: number;

	/**
	 * Creates a new BadgeGroupSpendPermissionError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including the HTTP status of the refusal.
	 */
	constructor(message: string, options: BadgeGroupSpendPermissionErrorOptions) {
		super(message, options);
		this.statusCode = options.statusCode;
	}
}
