import { OpenCloudError } from "./base.ts";

/**
 * Options for constructing a {@link NetworkError}.
 *
 * @since 0.1.0
 */
export interface NetworkErrorOptions extends ErrorOptions {
	/** HTTP method of the request that failed. */
	method?: string | undefined;
	/** Fully-qualified URL of the request that failed. */
	url?: string | undefined;
}

/**
 * Thrown when a network-level failure prevents the request from reaching
 * the Roblox Open Cloud API (e.g., DNS resolution failure, connection reset).
 * The `method` and `url` name the failing call so a transport failure that
 * survives every retry can be diagnosed; the underlying transport error is
 * carried on `cause`.
 *
 * @since 0.1.0
 */
export class NetworkError extends OpenCloudError {
	public readonly method: string | undefined;
	public override readonly name: string = "NetworkError";
	public readonly url: string | undefined;

	/**
	 * Creates a new NetworkError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including the optional `cause` and the
	 *   `method` / `url` of the request that failed.
	 */
	constructor(message: string, options?: NetworkErrorOptions) {
		super(message, options);
		this.method = options?.method;
		this.url = options?.url;
	}
}
