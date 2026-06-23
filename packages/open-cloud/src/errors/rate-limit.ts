import { OpenCloudError } from "./base.ts";

/**
 * Options for constructing a {@link RateLimitError}.
 *
 * @since 0.1.0
 */
export interface RateLimitErrorOptions extends ErrorOptions {
	/**
	 * Requests still allowed in the throttled window, read from
	 * `x-ratelimit-remaining` (the most-constrained window). `undefined` when
	 * the header is absent or carries no finite numeric token; parsed
	 * independently of `x-ratelimit-reset`, so a valid value survives a
	 * non-numeric reset. Typically `0` on a genuine 429.
	 */
	remaining?: number | undefined;
	/** Seconds to wait before retrying the request. */
	retryAfterSeconds: number;
}

/**
 * Thrown when the Roblox Open Cloud API returns a 429 Too Many Requests response.
 * Contains the server-suggested retry delay.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { RateLimitError } from "@bedrock-rbx/ocale";
 *
 * const error = new RateLimitError("Too many requests", {
 *     retryAfterSeconds: 30,
 * });
 *
 * expect(error).toBeInstanceOf(RateLimitError);
 * expect(error.retryAfterSeconds).toBe(30);
 * ```
 */
export class RateLimitError extends OpenCloudError {
	public override readonly name = "RateLimitError";
	/** Requests left in the throttled window, or `undefined` if not reported. */
	public readonly remaining: number | undefined;
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
		this.remaining = options.remaining;
	}
}
