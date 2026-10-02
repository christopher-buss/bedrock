import { OpenCloudError } from "./base.ts";
import type { RateLimitError } from "./rate-limit.ts";

/**
 * Options for constructing a {@link RateLimitWaitRefusedError}.
 *
 * @since 0.3.4
 */
export interface RateLimitWaitRefusedErrorOptions {
	/** The 429 whose requested wait the SDK refused. */
	readonly cause: RateLimitError;
}

/**
 * Returned at once when a 429 asks for a wait longer than the 60 seconds the
 * SDK waits out on its own. The server's requested wait is kept exactly as
 * sent, alongside the 429's evidence, so a caller can schedule its own retry.
 *
 * Distinct from a {@link RateLimitError} returned after `maxRetries` runs out,
 * and from a `RequestDeadlineExceededError`.
 *
 * @since 0.3.4
 *
 * @example
 *
 * ```ts
 * import { RateLimitError, RateLimitWaitRefusedError } from "@bedrock-rbx/ocale";
 *
 * const error = new RateLimitWaitRefusedError("Rate limit asks for a 300s wait", {
 *     cause: new RateLimitError("Rate limited", { remaining: 0, retryAfterSeconds: 300 }),
 * });
 *
 * expect(error.retryAfterSeconds).toBe(300);
 * expect(error.remaining).toBe(0);
 * ```
 */
export class RateLimitWaitRefusedError extends OpenCloudError {
	/** The 429 whose requested wait was refused. */
	public override readonly cause: RateLimitError;
	public override readonly name: string = "RateLimitWaitRefusedError";
	/** Requests left in the reported window, or `undefined` if not reported. */
	public readonly remaining: number | undefined;
	/**
	 * Allowlisted raw response headers of the 429, or `undefined` if not set.
	 */
	public readonly responseHeaders: Readonly<Record<string, string>> | undefined;
	/** The wait the server asked for, in seconds, uncapped. */
	public readonly retryAfterSeconds: number;

	/**
	 * Creates a new RateLimitWaitRefusedError.
	 *
	 * @param message - Human-readable description of the refused wait.
	 * @param options - The 429 whose requested wait was refused.
	 */
	constructor(message: string, { cause }: RateLimitWaitRefusedErrorOptions) {
		super(message, { cause, code: cause.code });
		this.cause = cause;
		this.remaining = cause.remaining;
		this.responseHeaders = cause.responseHeaders;
		this.retryAfterSeconds = cause.retryAfterSeconds;
	}
}
