import type { OpenCloudError } from "../../errors/base.ts";
import { RateLimitWaitRefusedError } from "../../errors/rate-limit-wait-refused.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import { RetryDelayExceededError } from "../../errors/retry-delay-exceeded.ts";
import type { Result } from "../../types.ts";
import { ABORTED, raceWithAbortAsync, requestAbortedError } from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { observeAdmissionWaitAsync } from "./admission-wait.ts";
import { waitDeadlineFailure } from "./request-deadline.ts";
import { computeRetryWaitMs, type RetryResolvable, shouldRetry } from "./retry.ts";
import type { AdmissionWaitObserver, HttpRequest, HttpResponse, OpenCloudHooks } from "./types.ts";

/**
 * Longest server-guided wait the SDK sleeps through. A 429 asking for more
 * describes an exhausted quota, so the request fails instead of waiting.
 */
const MAX_GUIDED_WAIT_SECONDS = 60;

/** A transport callback: takes a request, returns a classified Result. */
type SendFunc = (request: HttpRequest) => Promise<Result<HttpResponse, OpenCloudError>>;

interface RetryLimit {
	readonly cause: OpenCloudError;
	readonly deadlineMs: number | undefined;
	readonly retryAfterMs: number;
}

/** What follows a failed attempt: a wait to take, or a refusal to return. */
type RetryPlan =
	| { readonly refusal: OpenCloudError }
	| { readonly spendsAttempt: boolean; readonly waitMs: number };

interface RetryState {
	readonly config: RetryResolvable;
	readonly deadlineMs: number | undefined;
	readonly retries: number;
}

interface RetryNotification {
	readonly attempt: number;
	readonly error: OpenCloudError;
	readonly hooks: OpenCloudHooks;
	readonly waitMs: number;
}

/**
 * Inputs to {@link executeWithRetryAsync} bundled as an options object to keep
 * the function signature narrow.
 */
interface ExecuteOptions {
	/** Request-scoped admission-wait observer. */
	readonly admissionWaitObserver?: AdmissionWaitObserver | undefined;
	/** Fully-resolved retry config (post-merge). */
	readonly config: RetryResolvable;
	/**
	 * Absolute deadline for the logical request, as Unix epoch milliseconds.
	 */
	readonly deadlineMs?: number | undefined;
	/** Client-level observability hooks. */
	readonly hooks: OpenCloudHooks;
	/** Transport callback. May be pre-wrapped by a rate-limit queue. */
	readonly send: SendFunc;
	/** Optional caller cancellation signal. */
	readonly signal?: AbortSignal | undefined;
	/** Injectable sleep (tests pass a fake). */
	readonly sleep: SleepFunc;
}

/**
 * Retry-aware orchestration loop. Coordinates a single logical request,
 * looping over `options.send` until it succeeds, the error is non-retryable,
 * or `options.config.maxRetries` is exhausted. Server-guided rate-limit waits
 * do not count against `maxRetries`; the request deadline and `signal` bound
 * them instead. Fires observability hooks
 * at each transition. Domain- and queue-agnostic: `send` may be any
 * callback, including one wrapped by a rate-limit queue.
 *
 * @param request - The immutable request to send.
 * @param options - The transport callback, resolved config, hooks, and sleep.
 * @returns The first success, or the final error after retries are exhausted.
 */
export async function executeWithRetryAsync(
	request: HttpRequest,
	options: ExecuteOptions,
): Promise<Result<HttpResponse, OpenCloudError>> {
	const { config, deadlineMs, hooks, signal } = options;
	if (signal?.aborted === true) {
		return abortedResult(signal);
	}

	let result = await attemptAsync(request, options);
	let retries = 0;
	let waits = 0;

	while (!result.success) {
		const plan = planRetry(result.err, { config, deadlineMs, retries });
		if (plan === undefined) {
			return result;
		}

		if ("refusal" in plan) {
			return { err: plan.refusal, success: false };
		}

		retries += plan.spendsAttempt ? 1 : 0;
		waits += 1;
		announceRetry({ attempt: waits, error: result.err, hooks, waitMs: plan.waitMs });
		if ((await waitForRetryAsync(plan.waitMs, options)) === ABORTED) {
			return abortedResult(signal);
		}

		result = await attemptAsync(request, options);
	}

	return result;
}

function retryRefusal({
	cause,
	deadlineMs,
	retryAfterMs,
}: RetryLimit): RetryDelayExceededError | undefined {
	if (deadlineMs === undefined) {
		return undefined;
	}

	const refusal = waitDeadlineFailure({
		cause,
		deadlineMs,
		waitMs: retryAfterMs,
		waitReason: "retry-delay",
	});
	if (refusal === undefined) {
		return undefined;
	}

	const { remainingMs } = refusal;
	return new RetryDelayExceededError(
		`Retry delay would wait ${retryAfterMs / 1000}s; ${remainingMs / 1000}s remain before the request deadline`,
		{ cause, deadlineMs, remainingMs, retryAfterMs },
	);
}

function guidedWaitRefusal(cause: RateLimitError): RateLimitWaitRefusedError {
	return new RateLimitWaitRefusedError(
		`Rate limit asks for a ${cause.retryAfterSeconds}s wait, longer than the ${MAX_GUIDED_WAIT_SECONDS}s the SDK waits out`,
		{ cause },
	);
}

/**
 * Decides what follows a failed attempt. A rate limit carrying a server-guided
 * wait is waited out without spending one of `maxRetries`, unless the wait is
 * longer than {@link MAX_GUIDED_WAIT_SECONDS}, which is refused outright; every
 * other retryable failure spends one.
 *
 * @param err - The failure the attempt returned.
 * @param state - Resolved config, request deadline, and attempts spent so far.
 * @returns The wait to take, a refusal to return instead, or `undefined` to
 *   return the failure as is.
 */
function planRetry(
	err: OpenCloudError,
	{ config, deadlineMs, retries }: RetryState,
): RetryPlan | undefined {
	if (!shouldRetry(err, config)) {
		return undefined;
	}

	const guided = err instanceof RateLimitError && err.retryAfterSeconds > 0 ? err : undefined;
	if (guided === undefined && retries >= config.maxRetries) {
		return undefined;
	}

	if (guided !== undefined && guided.retryAfterSeconds > MAX_GUIDED_WAIT_SECONDS) {
		return { refusal: guidedWaitRefusal(guided) };
	}

	const waitMs = computeRetryWaitMs(err, { attempt: retries, retryDelay: config.retryDelay });
	const refusal = retryRefusal({ cause: err, deadlineMs, retryAfterMs: waitMs });
	return refusal === undefined ? { spendsAttempt: guided === undefined, waitMs } : { refusal };
}

async function waitForRetryAsync(
	waitMs: number,
	{ admissionWaitObserver, signal, sleep }: ExecuteOptions,
): Promise<typeof ABORTED | void> {
	return observeAdmissionWaitAsync({
		durationMs: waitMs,
		observer: admissionWaitObserver,
		reason: "retry-delay",
		waitAsync: async () => raceWithAbortAsync(async () => sleep(waitMs, signal), signal),
	});
}

function announceRetry({ attempt, error, hooks, waitMs }: RetryNotification): void {
	hooks.onRetry?.(attempt, error);
	hooks.onRateLimit?.(waitMs);
}

function abortedResult(signal: AbortSignal | undefined): Result<never, OpenCloudError> {
	return { err: requestAbortedError(signal), success: false };
}

async function attemptAsync(
	request: HttpRequest,
	{ hooks, send, signal }: ExecuteOptions,
): Promise<Result<HttpResponse, OpenCloudError>> {
	hooks.onRequest?.(request);
	const attempt = await raceWithAbortAsync(async () => send(request), signal);
	return attempt === ABORTED ? abortedResult(signal) : attempt;
}
