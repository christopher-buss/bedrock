import { OpenCloudError } from "../../errors/base.ts";

/**
 * Options for {@link AssetOperationError}.
 *
 * @since unreleased
 */
export interface AssetOperationErrorOptions {
	/** The error code the operation reported, if any. */
	readonly code: string | undefined;
	/** The error message the operation reported, if any. */
	readonly message: string | undefined;
	/** ID of the failed operation. */
	readonly operationId: string;
}

/**
 * An asset operation that finished with an error, such as an image upload
 * Roblox could not process. The request itself succeeded; the work it
 * started failed.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { AssetOperationError } from "@bedrock-rbx/ocale/assets";
 *
 * const error = new AssetOperationError({
 *     code: "INVALID_ARGUMENT",
 *     message: "The image could not be processed.",
 *     operationId: "op-1",
 * });
 * expect(error.message).toBe("Asset operation op-1 failed: The image could not be processed.");
 * expect(error.code).toBe("INVALID_ARGUMENT");
 * expect(new AssetOperationError({ code: undefined, message: undefined, operationId: "op-1" }).message).toBe("Asset operation op-1 failed");
 * ```
 */
export class AssetOperationError extends OpenCloudError {
	public override readonly name: string = "AssetOperationError";
	/** ID of the failed operation. */
	public readonly operationId: string;

	/**
	 * Creates an error for a failed asset operation.
	 *
	 * @param options - The operation ID and the error it reported.
	 */
	constructor({ code, message, operationId }: AssetOperationErrorOptions) {
		const reason = message === undefined ? "" : `: ${message}`;
		super(`Asset operation ${operationId} failed${reason}`, { code });
		this.operationId = operationId;
	}
}
