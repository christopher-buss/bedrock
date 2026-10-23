import { OpenCloudError, type OpenCloudErrorOptions } from "./base.ts";

/**
 * Options for constructing an {@link UnexpectedResponseError}.
 *
 * @since unreleased
 */
export interface UnexpectedResponseErrorOptions extends OpenCloudErrorOptions {
	/** The response body that did not match, when it was JSON or text. */
	details?: JSONValue | undefined;
	/** HTTP method of the request whose response did not match. */
	method?: string | undefined;
	/**
	 * Allowlisted response headers useful for diagnosis and escalation
	 * (request ids, edge/server identifiers), as on `ApiError.responseHeaders`.
	 */
	responseHeaders?: Readonly<Record<string, string>> | undefined;
	/** HTTP status code of the response that did not match. */
	statusCode: number;
	/** Fully-qualified URL of the request whose response did not match. */
	url?: string | undefined;
}

/**
 * Returned when Open Cloud accepts a request and answers, but the response
 * body has a shape that ocale's wire model rejects. The API did not refuse the
 * request, so this is not an `ApiError`: the fault is more likely a stale wire
 * model or a parser bug in ocale than a problem with the caller's input. The
 * raw body is kept on `details`, with the request context, so the mismatch can
 * be reported.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { ApiError, UnexpectedResponseError } from "@bedrock-rbx/ocale";
 *
 * const error = new UnexpectedResponseError("Malformed badge response", {
 *     details: { id: "not-a-number" },
 *     method: "GET",
 *     statusCode: 200,
 *     url: "https://apis.roblox.com/legacy-badges/v1/badges/1",
 * });
 *
 * // A shape mismatch is not an API rejection.
 * expect(error).not.toBeInstanceOf(ApiError);
 * expect(error.details).toStrictEqual({ id: "not-a-number" });
 * ```
 */
export class UnexpectedResponseError extends OpenCloudError {
	public readonly details: JSONValue | undefined;
	public readonly method: string | undefined;
	public override readonly name: string = "UnexpectedResponseError";
	public readonly responseHeaders: Readonly<Record<string, string>> | undefined;
	public readonly statusCode: number;
	public readonly url: string | undefined;

	/**
	 * Creates a new UnexpectedResponseError.
	 *
	 * @param message - Human-readable description naming the response that
	 *   did not match.
	 * @param options - The status code, the raw body as `details`, and the
	 *   request context when known.
	 */
	constructor(message: string, options: UnexpectedResponseErrorOptions) {
		super(message, options);
		this.details = options.details;
		this.method = options.method;
		this.responseHeaders = options.responseHeaders;
		this.statusCode = options.statusCode;
		this.url = options.url;
	}
}
