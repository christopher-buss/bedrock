import { OpenCloudError, type OpenCloudErrorOptions } from "./base.ts";

/**
 * Which layer refused a 429, as best the SDK can tell from one response.
 * It names the refusing layer only, not the cause of the refusal.
 *
 * - `"edge"`: the gateway refused before the request reached the service.
 * - `"service"`: the service behind the gateway refused (the response names it
 *   in `x-roblox-system-reason`).
 * - `"unknown"`: the response has no positive evidence for either layer.
 *
 * @since 0.4.0
 */
export type RateLimitSource = "edge" | "service" | "unknown";

/**
 * Options for constructing a {@link RateLimitError}.
 *
 * @since 0.1.0
 */
export interface RateLimitErrorOptions extends OpenCloudErrorOptions {
	/**
	 * Parsed 429 response body, when present. Holds the server's 429
	 * explanation (JSON when the body parses, otherwise the truncated raw
	 * text) so a rate limit stays diagnosable from the error alone. A literal
	 * JSON `null` remains `null`; an absent body is `undefined`.
	 */
	details?: JSONValue | undefined;
	/**
	 * Requests left in the reported rate-limit window. Read from
	 * `x-ratelimit-remaining` using the smallest valid token.
	 *
	 * `undefined` when the header has no valid non-negative integer token.
	 *
	 * Parsed separately from `x-ratelimit-reset`; a valid value survives an
	 * invalid reset.
	 *
	 * This is one budget reading, not a classifier for the cause of the 429.
	 */
	remaining?: number | undefined;
	/**
	 * Allowlisted response headers useful for diagnosing the 429. Values are
	 * preserved exactly as the Fetch API presents them, including comma-joined
	 * multi-window values. The full header set is never retained.
	 */
	responseHeaders?: Readonly<Record<string, string>> | undefined;
	/** Seconds to wait before retrying the request. */
	retryAfterSeconds: number;
	/**
	 * Which layer refused the request. Defaults to `"unknown"`.
	 *
	 * @since 0.4.0
	 */
	source?: RateLimitSource | undefined;
	/**
	 * HTTP status code that produced the error. Always `429` when minted by the
	 * SDK transport; `undefined` when constructed without one.
	 */
	statusCode?: number | undefined;
}

/**
 * Thrown when the Roblox Open Cloud API returns a 429 Too Many Requests
 * response. Contains the server-suggested retry delay and safe,
 * machine-readable response evidence. The body code, remaining budget, and
 * headers do not identify the upstream cause (for example quota vs place
 * capacity). `source` names only the layer that refused the request;
 * `"unknown"` means the response carried no positive evidence for either
 * layer.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { RateLimitError } from "@bedrock-rbx/ocale";
 *
 * const error = new RateLimitError("Too many requests", {
 *     code: "RESOURCE_EXHAUSTED",
 *     remaining: 3,
 *     responseHeaders: {
 *         "retry-after": "1856",
 *         "x-ratelimit-limit": "5, 5;w=60, 5;w=60",
 *     },
 *     retryAfterSeconds: 1856,
 *     source: "service",
 * });
 *
 * // `source` is a classification; the raw evidence stays available.
 * const evidence = {
 *     code: error.code,
 *     limit: error.responseHeaders?.["x-ratelimit-limit"],
 *     retryAfter: error.responseHeaders?.["retry-after"],
 *     source: error.source,
 * };
 *
 * expect(evidence).toEqual({
 *     code: "RESOURCE_EXHAUSTED",
 *     limit: "5, 5;w=60, 5;w=60",
 *     retryAfter: "1856",
 *     source: "service",
 * });
 * ```
 */
export class RateLimitError extends OpenCloudError {
	/**
	 * Parsed 429 response body. A literal JSON `null` remains `null`; an absent
	 * body is `undefined`.
	 */
	public readonly details: JSONValue | undefined;
	public override readonly name = "RateLimitError";
	/**
	 * Requests left in the reported window, or `undefined` if not reported.
	 */
	public readonly remaining: number | undefined;
	/** Allowlisted raw response headers, or `undefined` if not set. */
	public readonly responseHeaders: Readonly<Record<string, string>> | undefined;
	public readonly retryAfterSeconds: number;
	/**
	 * Which layer refused the request, or `"unknown"` without evidence.
	 *
	 * @since 0.4.0
	 */
	public readonly source: RateLimitSource;
	/** HTTP status code that produced the error, or `undefined` if not set. */
	public readonly statusCode: number | undefined;

	/**
	 * Creates a new RateLimitError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including the retry delay.
	 */
	constructor(message: string, options: RateLimitErrorOptions) {
		super(message, options);
		this.retryAfterSeconds = options.retryAfterSeconds;
		this.remaining = options.remaining;
		this.responseHeaders = options.responseHeaders;
		this.details = options.details;
		this.statusCode = options.statusCode;
		this.source = options.source ?? "unknown";
	}
}

const GUIDED_ERRORS = new WeakSet<RateLimitError>();

/**
 * Marks a transport-minted error whose zero-second delay is explicit guidance.
 *
 * @param error - The classified rate-limit failure.
 * @returns The same error, marked for retry orchestration.
 */
export function markServerRetryGuidance(error: RateLimitError): RateLimitError {
	GUIDED_ERRORS.add(error);
	return error;
}

/**
 * Checks whether an error carries applicable server retry guidance.
 *
 * @param error - The rate-limit failure to inspect.
 * @returns Whether its delay should override caller backoff.
 */
export function hasServerRetryGuidance(error: RateLimitError): boolean {
	return error.retryAfterSeconds > 0 || GUIDED_ERRORS.has(error);
}
