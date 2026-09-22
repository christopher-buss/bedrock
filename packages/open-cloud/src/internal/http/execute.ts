import type { OpenCloudError } from "../../errors/base.ts";
import { RetryDelayExceededError } from "../../errors/retry-delay-exceeded.ts";
import type { Result } from "../../types.ts";
import { ABORTED, raceWithAbortAsync, requestAbortedError } from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { observeAdmissionWaitAsync } from "./admission-wait.ts";
import { waitDeadlineFailure } from "./request-deadline.ts";
import { computeRetryWaitMs, type RetryResolvable, shouldRetry } from "./retry.ts";
import type { AdmissionWaitObserver, HttpRequest, HttpResponse, OpenCloudHooks } from "./types.ts";

/** A transport callback: takes a request, returns a classified Result. */
type SendFunc = (request: HttpRequest) => Promise<Result<HttpResponse, OpenCloudError>>;

interface RetryLimit {
	readonly cause: OpenCloudError;
	readonly deadlineMs: number | undefined;
	readonly retryAfterMs: number;
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
 * or `options.config.maxRetries` is exhausted. Fires observability hooks
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
	const { admissionWaitObserver, config, deadlineMs, hooks, signal, sleep } = options;
	if (signal?.aborted === true) {
		return abortedResult(signal);
	}

	let result = await attemptAsync(request, options);

	for (let retry = 0; retry < config.maxRetries; retry++) {
		if (result.success || !shouldRetry(result.err, config)) {
			return result;
		}

		const { err } = result;
		const waitMs = computeRetryWaitMs(err, { attempt: retry, retryDelay: config.retryDelay });
		const refusal = retryRefusal({ cause: err, deadlineMs, retryAfterMs: waitMs });
		if (refusal !== undefined) {
			return { err: refusal, success: false };
		}

		announceRetry({ attempt: retry + 1, error: err, hooks, waitMs });
		const sleepResult = await observeAdmissionWaitAsync({
			durationMs: waitMs,
			observer: admissionWaitObserver,
			reason: "retry-delay",
			waitAsync: async () => raceWithAbortAsync(async () => sleep(waitMs, signal), signal),
		});
		if (sleepResult === ABORTED) {
			return abortedResult(signal);
		}

		result = await attemptAsync(request, options);
	}

	return result;
}

function announceRetry({ attempt, error, hooks, waitMs }: RetryNotification): void {
	hooks.onRetry?.(attempt, error);
	hooks.onRateLimit?.(waitMs);
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
