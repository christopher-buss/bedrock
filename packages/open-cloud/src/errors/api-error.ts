import { OpenCloudError } from "./base.ts";

/**
 * Options for constructing an {@link ApiError}.
 */
export interface ApiErrorOptions extends ErrorOptions {
	/** Optional machine-readable error code from the API. */
	code?: string | undefined;
	/** HTTP status code from the API response. */
	statusCode: number;
}

/**
 * Thrown when the Roblox Open Cloud API returns a non-2xx response
 * that is not a rate limit (429).
 *
 * @example
 *
 * ```ts
 * import { ApiError } from "@bedrock-rbx/ocale";
 *
 * const error = new ApiError("Game pass not found", {
 *     code: "NotFound",
 *     statusCode: 404,
 * });
 *
 * expect(error).toBeInstanceOf(ApiError);
 * expect(error.statusCode).toBe(404);
 * expect(error.code).toBe("NotFound");
 * ```
 */
export class ApiError extends OpenCloudError {
	public readonly code: string | undefined;
	public override readonly name: string = "ApiError";
	public readonly statusCode: number;

	/**
	 * Creates a new ApiError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including status code and optional error code.
	 */
	constructor(message: string, options: ApiErrorOptions) {
		super(message, options);
		this.statusCode = options.statusCode;
		this.code = options.code;
	}
}
