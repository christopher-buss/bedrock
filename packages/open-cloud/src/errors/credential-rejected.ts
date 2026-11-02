import { OpenCloudError, type OpenCloudErrorOptions } from "./base.ts";

/**
 * Options for constructing a {@link CredentialRejectedError}.
 *
 * @since 0.4.0
 */
export interface CredentialRejectedErrorOptions extends OpenCloudErrorOptions {
	/** The OAuth Credential identity whose token Roblox refused. */
	readonly identity: string;
	/** HTTP status code of the refusal (401 or 502). */
	readonly statusCode: number;
}

/**
 * Returned when Roblox refuses an OAuth Credential's token: a non-gateway
 * 401, or a non-gateway 502 whose body message is "Scope authorization
 * failed.". The grant is lost, so the client does not retry. Carries the
 * Credential `identity` (never the token) so the caller can ask that user to
 * consent again. The upstream `ApiError` is the `cause`.
 *
 * @since 0.4.0
 *
 * @example
 *
 * ```ts
 * import { CredentialRejectedError } from "@bedrock-rbx/ocale";
 *
 * const error = new CredentialRejectedError("HTTP 401: Invalid Token.", {
 *     identity: "user-123",
 *     statusCode: 401,
 * });
 *
 * expect(error.identity).toBe("user-123");
 * expect(error.statusCode).toBe(401);
 * ```
 */
export class CredentialRejectedError extends OpenCloudError {
	public readonly identity: string;
	public override readonly name: string = "CredentialRejectedError";
	public readonly statusCode: number;

	/**
	 * Creates a new CredentialRejectedError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including the Credential identity and
	 *   the HTTP status of the refusal.
	 */
	constructor(message: string, options: CredentialRejectedErrorOptions) {
		super(message, options);
		this.identity = options.identity;
		this.statusCode = options.statusCode;
	}
}
