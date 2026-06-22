import type { OpenCloudError } from "../../errors/base.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import type { Result } from "../../types.ts";
import type { RateLimitSample } from "./rate-limit-sample.ts";
import { parseRateLimitHeaders } from "./rate-limit-sample.ts";
import type { HttpResponse } from "./types.ts";

/**
 * Extracts a {@link RateLimitSample} from a transport result so the budget gate
 * can be fed from every attempt. A 2xx carries the budget in its headers; a 429
 * carries it on the {@link RateLimitError} (the raw headers are dropped before
 * this point). Any other error, or a response that reported no budget, yields
 * `undefined` and leaves the gate on static pacing.
 *
 * @param result - The classified transport result for one attempt.
 * @returns The parsed sample, or `undefined` when none was reported.
 */
export function rateLimitSampleFromResult(
	result: Result<HttpResponse, OpenCloudError>,
): RateLimitSample | undefined {
	if (result.success) {
		return parseRateLimitHeaders(result.data.headers);
	}

	const { err } = result;
	if (err instanceof RateLimitError && err.remaining !== undefined) {
		return { remaining: err.remaining, resetSeconds: err.retryAfterSeconds };
	}

	return undefined;
}
