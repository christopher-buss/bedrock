import type { OpenCloudError } from "../../errors/base.ts";
import { RequestAbortedError } from "../../errors/request-aborted.ts";
import type { Result } from "../../types.ts";
import { ABORTED, raceWithAbortAsync } from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { observeAdmissionWaitAsync } from "./admission-wait.ts";
import { computeRetryWaitMs, type RetryResolvable, shouldRetry } from "./retry.ts";
import type { AdmissionWaitObserver, HttpRequest, HttpResponse, OpenCloudHooks } from "./types.ts";

/** A transport callback: takes a request, returns a classified Result. */
type SendFunc = (request: HttpRequest) => Promise<Result<HttpResponse, OpenCloudError>>;

/**
 * Inputs to {@link executeWithRetryAsync} bundled as an options object to keep
 * the function signature narrow.
 */
interface ExecuteOptions {
	/** Request-scoped admission-wait observer. */
	readonly admissionWaitObserver?: AdmissionWaitObserver | undefined;
	/** Fully-resolved retry config (post-merge). */
	readonly config: RetryResolvable;
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
	const { admissionWaitObserver, config, hooks, signal, sleep } = options;
	if (signal?.aborted === true) {
		return abortedResult(signal);
	}

	let result = await attemptAsync(request, options);

	for (let retry = 0; retry < config.maxRetries; retry++) {
		if (result.success || !shouldRetry(result.err, config)) {
			return result;
		}

		const { err } = result;
		hooks.onRetry?.(retry + 1, err);
		const waitMs = computeRetryWaitMs(err, { attempt: retry, retryDelay: config.retryDelay });
		hooks.onRateLimit?.(waitMs);
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

function abortedResult(signal: AbortSignal | undefined): Result<never, OpenCloudError> {
	return {
		err: new RequestAbortedError("Request was aborted", { reason: signal?.reason }),
		success: false,
	};
}

async function attemptAsync(
	request: HttpRequest,
	{ hooks, send, signal }: ExecuteOptions,
): Promise<Result<HttpResponse, OpenCloudError>> {
	hooks.onRequest?.(request);
	const attempt = await raceWithAbortAsync(async () => send(request), signal);
	return attempt === ABORTED ? abortedResult(signal) : attempt;
}
