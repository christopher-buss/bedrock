import {
	markServerRetryGuidance,
	RateLimitError,
	type RateLimitSource,
} from "../../errors/rate-limit.ts";
import { isRecord } from "../utils/is-record.ts";
import { headersToRecord, pickRateLimitHeaders } from "./diagnostics.ts";
import { reduceRateLimitTokens } from "./rate-limit-sample.ts";
import { resolveRetryGuidance } from "./retry-guidance.ts";

/**
 * Classifies which layer refused a 429 from its headers and parsed body.
 * `"service"` needs a non-blank `x-roblox-system-reason` header. `"edge"`
 * needs no such header and a body of only `{ code: 0, message: "" }` entries
 * under `errors`. Anything else, including a body `code` alone, is
 * `"unknown"`.
 *
 * @param headers - The response headers (lowercased keys).
 * @param details - The parsed or safely truncated response body.
 * @returns The refusing layer, or `"unknown"` without positive evidence.
 */
export function classifyRateLimitSource(
	headers: Readonly<Record<string, string>>,
	details: JSONValue | undefined,
): RateLimitSource {
	const reason = headers["x-roblox-system-reason"];
	if (isNonBlankString(reason)) {
		return "service";
	}

	return isEdgeBody(details) ? "edge" : "unknown";
}

/**
 * Builds a public rate-limit error from a 429 response and its already-read
 * body, retaining safe raw evidence alongside the existing parsed guidance.
 *
 * @param response - The 429 response to classify.
 * @param details - The parsed or safely truncated response body.
 * @returns A rate-limit error carrying the response evidence.
 */
export function createRateLimitError(
	response: Response,
	details: JSONValue | undefined,
): RateLimitError {
	const headers = headersToRecord(response.headers);
	const remaining = reduceRateLimitTokens(headers["x-ratelimit-remaining"], (a, b) => {
		return Math.min(a, b);
	});
	const guidedRetrySeconds = resolveRetryGuidance({ headers, remaining });
	const error = new RateLimitError("Rate limited", {
		code: extractRateLimitErrorCode(details),
		details,
		remaining,
		responseHeaders: pickRateLimitHeaders(headers),
		retryAfterSeconds: guidedRetrySeconds ?? 0,
		source: classifyRateLimitSource(headers, details),
		statusCode: response.status,
	});
	return guidedRetrySeconds === undefined ? error : markServerRetryGuidance(error);
}

function isEdgeBody(body: unknown): boolean {
	if (!isRecord(body)) {
		return false;
	}

	const { errors } = body;
	return (
		Array.isArray(errors) &&
		errors.length > 0 &&
		errors.every((entry: unknown) => {
			return isRecord(entry) && entry["code"] === 0 && entry["message"] === "";
		})
	);
}

function isNonBlankString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function extractRateLimitErrorCode(body: unknown): string | undefined {
	if (!isRecord(body)) {
		return undefined;
	}

	const { code } = body;
	return isNonBlankString(code) ? code : undefined;
}
