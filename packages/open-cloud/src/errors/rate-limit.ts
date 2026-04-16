import { OpenCloudError } from "./base.ts";

/**
 * Options for constructing a {@link RateLimitError}.
 */
export interface RateLimitErrorOptions extends ErrorOptions {
	/** Seconds to wait before retrying the request. */
	retryAfterSeconds: number;
}

/**
 * Thrown when the Roblox Open Cloud API returns a 429 Too Many Requests response.
 * Contains the server-suggested retry delay.
 */
export class RateLimitError extends OpenCloudError {
	public override readonly name = "RateLimitError";
	public readonly retryAfterSeconds: number;

	/**
	 * Creates a new RateLimitError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including the retry delay.
	 */
	constructor(message: string, options: RateLimitErrorOptions) {
		super(message, options);
		this.retryAfterSeconds = options.retryAfterSeconds;
	}
}
