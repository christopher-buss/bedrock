import { markServerRetryGuidance, RateLimitError } from "../../errors/rate-limit.ts";
import { headersToRecord, pickRateLimitHeaders } from "./diagnostics.ts";
import { reduceRateLimitTokens } from "./rate-limit-sample.ts";
import { resolveRetryGuidance } from "./retry-guidance.ts";

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
		statusCode: response.status,
	});
	return guidedRetrySeconds === undefined ? error : markServerRetryGuidance(error);
}

function extractRateLimitErrorCode(body: unknown): string | undefined {
	if (body === null || typeof body !== "object") {
		return undefined;
	}

	const code = Reflect.get(body, "code");
	return typeof code === "string" && code.trim() !== "" ? code : undefined;
}
