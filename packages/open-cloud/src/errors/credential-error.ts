import { OpenCloudError, type OpenCloudErrorOptions } from "./base.ts";

/**
 * Options for constructing a {@link CredentialError}.
 *
 * @since 0.4.0
 */
export type CredentialErrorOptions = OpenCloudErrorOptions;

/**
 * Returned when an OAuth credential's `getAccessToken` throws or rejects.
 * The provider's error is the `cause`, passed through unchanged. The client
 * sends no request for that attempt and spends no retry.
 *
 * @since 0.4.0
 *
 * @example
 *
 * ```ts
 * import { CredentialError } from "@bedrock-rbx/ocale";
 *
 * const providerError = new Error("refresh token revoked");
 * const error = new CredentialError("Credential provider failed", {
 *     cause: providerError,
 * });
 *
 * expect(error).toBeInstanceOf(CredentialError);
 * expect(error.cause).toBe(providerError);
 * ```
 */
export class CredentialError extends OpenCloudError {
	public override readonly name: string = "CredentialError";
}
