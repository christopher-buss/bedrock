import { OpenCloudError, type OpenCloudErrorOptions } from "./base.ts";

/**
 * Options for constructing a {@link TokenRefreshError}.
 *
 * @since unreleased
 */
export interface TokenRefreshErrorOptions extends OpenCloudErrorOptions {
	/** HTTP status of the token endpoint's response. */
	readonly statusCode: number;
}

/**
 * Thrown by the `getAccessToken` that `createOAuthTokenRefresher` returns
 * when the Roblox token endpoint refuses a refresh. `code` is the OAuth
 * `error` field of the response body (for example `invalid_grant`), or
 * `undefined` when the body has none. A client that calls the provider
 * returns it as the `cause` of a `CredentialError`.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { TokenRefreshError } from "@bedrock-rbx/ocale";
 *
 * const error = new TokenRefreshError("Token refresh refused", {
 *     code: "invalid_grant",
 *     statusCode: 400,
 * });
 *
 * expect(error.code).toBe("invalid_grant");
 * expect(error.statusCode).toBe(400);
 * ```
 */
export class TokenRefreshError extends OpenCloudError {
	public override readonly name: string = "TokenRefreshError";
	/** HTTP status of the token endpoint's response. */
	public readonly statusCode: number;

	/**
	 * Creates a new TokenRefreshError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - The OAuth error code and the HTTP status.
	 */
	constructor(message: string, options: TokenRefreshErrorOptions) {
		super(message, options);
		this.statusCode = options.statusCode;
	}
}
