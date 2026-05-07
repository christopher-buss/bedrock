import { OpenCloudError } from "./base.ts";

/**
 * Options for constructing an {@link ApiError}.
 */
export interface ApiErrorOptions extends ErrorOptions {
	/** Optional machine-readable error code from the API. */
	code?: string | undefined;
	/** Parsed response body, when present. */
	details?: JSONValue | undefined;
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
 * import { ApiError } from "@bedrock/ocale";
 *
 * const error = new ApiError("HTTP 404: Pass not found (code NotFound)", {
 *     code: "NotFound",
 *     details: { errorCode: "NotFound", message: "Pass not found" },
 *     statusCode: 404,
 * });
 *
 * expect(error).toBeInstanceOf(ApiError);
 * expect(error.statusCode).toBe(404);
 * expect(error.code).toBe("NotFound");
 * expect(error.details).toEqual({
 *     errorCode: "NotFound",
 *     message: "Pass not found",
 * });
 * ```
 */
export class ApiError extends OpenCloudError {
	public readonly code: string | undefined;
	public readonly details: JSONValue | undefined;
	public override readonly name: string = "ApiError";
	public readonly statusCode: number;

	/**
	 * Creates a new ApiError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including status code, optional error
	 *   code, and the parsed response body when present.
	 */
	constructor(message: string, options: ApiErrorOptions) {
		super(message, options);
		this.statusCode = options.statusCode;
		this.code = options.code;
		this.details = options.details;
	}
}
