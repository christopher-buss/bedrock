import { OpenCloudError, type OpenCloudErrorOptions } from "./base.ts";

/**
 * Options for constructing a {@link CredentialNotSupportedError}.
 *
 * @since unreleased
 */
export interface CredentialNotSupportedErrorOptions extends OpenCloudErrorOptions {
	/** Rate-limit key of the Operation that accepts only an API key. */
	readonly operationKey: string;
}

/**
 * Returned when an OAuth credential calls an Operation that Roblox accepts
 * only with an API key (place publish and save, Luau execution and memory
 * stores). The client returns it before it asks the provider for a token, and
 * it sends no request.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { CredentialNotSupportedError } from "@bedrock-rbx/ocale";
 *
 * const error = new CredentialNotSupportedError("Operation needs an API key", {
 *     operationKey: "places.publishVersion",
 * });
 *
 * expect(error).toBeInstanceOf(CredentialNotSupportedError);
 * expect(error.operationKey).toBe("places.publishVersion");
 * ```
 */
export class CredentialNotSupportedError extends OpenCloudError {
	public override readonly name: string = "CredentialNotSupportedError";
	public readonly operationKey: string;

	/**
	 * Creates a new CredentialNotSupportedError.
	 *
	 * @param message - Human-readable description of the failure.
	 * @param options - Error options including the Operation's key.
	 */
	constructor(message: string, options: CredentialNotSupportedErrorOptions) {
		super(message, options);
		this.operationKey = options.operationKey;
	}
}
