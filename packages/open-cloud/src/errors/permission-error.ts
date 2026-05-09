import { ApiError, type ApiErrorOptions } from "./api-error.ts";

/**
 * Options for constructing a {@link PermissionError}.
 */
export interface PermissionErrorOptions extends ApiErrorOptions {
	/**
	 * Stable identifier of the Open Cloud operation that returned the
	 * permission failure (matches `OperationLimit.operationKey`, e.g.
	 * `"developer-products.create"`).
	 */
	operationKey: string;
	/**
	 * Scope strings the API key or OAuth token must carry for the failing
	 * operation, sourced from the vendored OpenAPI schema's `x-roblox-scopes`
	 * for that operationId.
	 */
	requiredScopes: ReadonlyArray<string>;
}

/**
 * Thrown when the Roblox Open Cloud API returns a 401 or 403 for an operation
 * whose required scopes are known. Subclass of {@link ApiError} carrying the
 * scope strings the caller's credential is missing plus the operation key, so
 * a CLI consumer can tell the user exactly which scope to grant on their API
 * key.
 *
 * @example
 *
 * ```ts
 * import { PermissionError } from "@bedrock-rbx/ocale";
 *
 * const error = new PermissionError("HTTP 403", {
 *     operationKey: "developer-products.create",
 *     requiredScopes: ["creator-store-product:write"],
 *     statusCode: 403,
 * });
 *
 * expect(error).toBeInstanceOf(PermissionError);
 * expect(error.requiredScopes).toStrictEqual(["creator-store-product:write"]);
 * expect(error.operationKey).toBe("developer-products.create");
 * ```
 */
export class PermissionError extends ApiError {
	public override readonly name: string = "PermissionError";
	public readonly operationKey: string;
	public readonly requiredScopes: ReadonlyArray<string>;

	/**
	 * Creates a new PermissionError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including status code, the operation key,
	 *   and the scopes the caller's credential must carry.
	 */
	constructor(message: string, options: PermissionErrorOptions) {
		super(message, options);
		this.operationKey = options.operationKey;
		this.requiredScopes = options.requiredScopes;
	}
}
