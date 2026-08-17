import { OpenCloudError } from "./base.ts";

/**
 * Options for constructing an {@link ApiError}.
 *
 * @since 0.1.0
 */
export interface ApiErrorOptions extends ErrorOptions {
	/** Optional machine-readable error code from the API. */
	code?: string | undefined;
	/** Parsed response body, when present. */
	details?: JSONValue | undefined;
	/**
	 * Wall-clock time the request was in flight before this error, in
	 * milliseconds. Present for errors built by the transport; a long elapsed
	 * time on an intermittent failure points at a load or timeout correlation.
	 */
	elapsedMs?: number | undefined;
	/**
	 * Human-readable summary extracted from an HTML gateway error page, set
	 * when the error body was such a page (an HAProxy-style load-balancer
	 * rejection) rather than an Open Cloud response. When present, the raw HTML
	 * is not retained on {@link ApiError.details}.
	 */
	gatewaySummary?: string | undefined;
	/** HTTP method of the request that produced this error. */
	method?: string | undefined;
	/**
	 * Allowlisted response headers useful for diagnosis and escalation (request
	 * ids, edge/server identifiers). The full header set is never retained, to
	 * avoid surfacing anything sensitive and to keep errors light.
	 */
	responseHeaders?: Readonly<Record<string, string>> | undefined;
	/** HTTP status code from the API response. */
	statusCode: number;
	/**
	 * Length, in decoded characters, of a 2xx body that could not be parsed as
	 * JSON. Set only by the transport, and only for that failure — nothing else
	 * builds an {@link ApiError} over a successful status — so its presence is
	 * also how a body-parse failure is told apart from an API rejection. The
	 * number is the diagnostic one: a body that stops mid-token at exactly the
	 * length the edge delivered is a truncated read, not malformed JSON.
	 */
	unparsedBodyLength?: number | undefined;
	/** Fully-qualified URL of the request that produced this error. */
	url?: string | undefined;
}

/**
 * Thrown when the Roblox Open Cloud API returns a non-2xx response
 * that is not a rate limit (429).
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { ApiError } from "@bedrock-rbx/ocale";
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
	public readonly elapsedMs: number | undefined;
	public readonly gatewaySummary: string | undefined;
	public readonly method: string | undefined;
	public override readonly name: string = "ApiError";
	public readonly responseHeaders: Readonly<Record<string, string>> | undefined;
	public readonly statusCode: number;
	public readonly unparsedBodyLength: number | undefined;
	public readonly url: string | undefined;

	/**
	 * Creates a new ApiError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including status code, optional error
	 *   code, the parsed response body when present, and the request context
	 *   (method, url, elapsed time, allowlisted response headers) when built by
	 *   the transport.
	 */
	constructor(message: string, options: ApiErrorOptions) {
		super(message, options);
		this.statusCode = options.statusCode;
		this.code = options.code;
		this.details = options.details;
		this.method = options.method;
		this.url = options.url;
		this.elapsedMs = options.elapsedMs;
		this.responseHeaders = options.responseHeaders;
		this.gatewaySummary = options.gatewaySummary;
		this.unparsedBodyLength = options.unparsedBodyLength;
	}
}
