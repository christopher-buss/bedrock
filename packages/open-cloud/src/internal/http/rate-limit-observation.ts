import type { OpenCloudError } from "../../errors/base.ts";
import { hasServerRetryGuidance, RateLimitError } from "../../errors/rate-limit.ts";
import type { Result } from "../../types.ts";
import type { BudgetGate, BudgetScope } from "./budget-gate.ts";
import type { RateLimitSample } from "./rate-limit-sample.ts";
import { parseRateLimitHeaders, withReportedWindow } from "./rate-limit-sample.ts";
import { MAX_GUIDED_WAIT_SECONDS } from "./retry-guidance.ts";
import { isRefusedGuidedWait } from "./retry.ts";
import type { HttpResponse } from "./types.ts";

/**
 * Returns `true` when a long 429's evidence shows it clears on some other
 * event than its guided wait, so it must not lock its scope out.
 */
export type LockoutExemption = (error: RateLimitError) => boolean;

/** One sent attempt, as the budget gate learns from it. */
export interface ObservedAttempt {
	/** Returns `true` to keep a long 429 from locking the scope out. */
	readonly exemptsLockout: LockoutExemption | undefined;
	/** The scope the attempt was gated on. */
	readonly scope: BudgetScope;
	/** The classified, unrefined transport result of the attempt. */
	readonly transportResult: Result<HttpResponse, OpenCloudError>;
}

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
	return !result.success && isRefusedGuidedWait(result.err) ? result.err : undefined;
}

/**
 * Feeds one attempt back into the budget gate: its reported budget always,
 * and a long 429 as a lockout unless the caller exempts it (such as a 429
 * naming tasks that occupy a Luau place).
 *
 * @param budgets - The gate shared across the client.
 * @param attempt - The scope, transport result, and lockout exemption.
 */
export function observeAttempt(
	budgets: BudgetGate,
	{ exemptsLockout, scope, transportResult }: ObservedAttempt,
): void {
	budgets.observe(scope, rateLimitSampleFromResult(transportResult));
	const lockout = rateLimitLockoutFromResult(transportResult);
	if (lockout !== undefined && exemptsLockout?.(lockout) !== true) {
		budgets.lockOut(scope, lockout);
	}
}
