import type { OpenCloudError } from "../../errors/base.ts";
import { hasServerRetryGuidance, RateLimitError } from "../../errors/rate-limit.ts";
import type { Result } from "../../types.ts";
import type { RateLimitSample } from "./rate-limit-sample.ts";
import { parseRateLimitHeaders, withReportedWindow } from "./rate-limit-sample.ts";
import { MAX_GUIDED_WAIT_SECONDS } from "./retry-guidance.ts";
import type { HttpResponse } from "./types.ts";

/**
 * Extracts a {@link RateLimitSample} from a transport result so the budget
 * gate can be fed from every attempt. A 2xx carries the budget in its headers.
 * A 429 with valid server guidance primes the gate as spent for its guided
 * wait, whatever `x-ratelimit-remaining` reports: the remaining count is only
 * a pacing hint on 2xx responses. A 429 asking for a longer wait than the SDK
 * takes is refused, so it does not prime the gate either. A 429 also carries
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
		hasServerRetryGuidance(err) &&
		err.retryAfterSeconds <= MAX_GUIDED_WAIT_SECONDS
	) {
		const sample = { remaining: 0, resetSeconds: err.retryAfterSeconds };
		return withReportedWindow(sample, err.responseHeaders?.["x-ratelimit-limit"]);
	}

	return undefined;
}

/**
 * Picks out a 429 whose guided wait is longer than the SDK waits out on its
 * own. Such a lockout is refused, and later requests on the same scope fail
 * locally until it ends instead of reaching the server.
 *
 * @param result - The classified transport result for one attempt.
 * @returns The locking 429, or `undefined` for any other result.
 */
export function rateLimitLockoutFromResult(
	result: Result<HttpResponse, OpenCloudError>,
): RateLimitError | undefined {
	if (
		!result.success &&
		result.err instanceof RateLimitError &&
		result.err.retryAfterSeconds > MAX_GUIDED_WAIT_SECONDS
	) {
		return result.err;
	}

	return undefined;
}
