import type { OpenCloudError } from "../../errors/base.ts";
import { hasServerRetryGuidance, RateLimitError } from "../../errors/rate-limit.ts";
import type { Result } from "../../types.ts";
import type { RateLimitSample } from "./rate-limit-sample.ts";
import { parseRateLimitHeaders } from "./rate-limit-sample.ts";
import type { HttpResponse } from "./types.ts";

/**
 * Extracts a {@link RateLimitSample} from a transport result so the budget gate
 * can be fed from every attempt. A 2xx carries the budget in its headers. A 429
 * only primes the gate when it reports zero remaining and valid guidance. This
 * is a conservative scheduling condition, not a semantic classification of the
 * 429. Any other error yields `undefined`.
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
	if (err instanceof RateLimitError && err.remaining === 0 && hasServerRetryGuidance(err)) {
		return { remaining: err.remaining, resetSeconds: err.retryAfterSeconds };
	}

	return undefined;
}
