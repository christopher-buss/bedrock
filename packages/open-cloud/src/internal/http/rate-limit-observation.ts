import type { OpenCloudError } from "../../errors/base.ts";
import { hasServerRetryGuidance, RateLimitError } from "../../errors/rate-limit.ts";
import type { Result } from "../../types.ts";
import type { RateLimitSample } from "./rate-limit-sample.ts";
import { parseRateLimitHeaders, parseRateLimitWindow } from "./rate-limit-sample.ts";
import { MAX_GUIDED_WAIT_SECONDS } from "./retry-guidance.ts";
import type { HttpResponse } from "./types.ts";

/**
 * Extracts a {@link RateLimitSample} from a transport result so the budget
 * gate can be fed from every attempt. A 2xx carries the budget in its headers.
 * A 429 only primes the gate when it reports zero remaining and valid
 * guidance. This is a conservative scheduling condition, not a semantic
 * classification of the 429. A 429 asking for a longer wait than the SDK takes
 * is refused, so it does not hold later requests either. A 429 also carries
 * the window capacity its `x-ratelimit-limit` header reports. Any other error
 * yields `undefined`.
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
	if (
		err instanceof RateLimitError &&
		err.remaining === 0 &&
		hasServerRetryGuidance(err) &&
		err.retryAfterSeconds <= MAX_GUIDED_WAIT_SECONDS
	) {
		const sample = { remaining: err.remaining, resetSeconds: err.retryAfterSeconds };
		const window = parseRateLimitWindow(err.responseHeaders?.["x-ratelimit-limit"]);
		return window === undefined ? sample : { ...sample, window };
	}

	return undefined;
}
