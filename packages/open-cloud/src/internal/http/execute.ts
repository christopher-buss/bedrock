import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { computeRetryWaitMs, type RetryResolvable, shouldRetry } from "./retry.ts";
import type { HttpRequest, HttpResponse, OpenCloudHooks } from "./types.ts";

/** A transport callback: takes a request, returns a classified Result. */
export type SendFunc = (request: HttpRequest) => Promise<Result<HttpResponse, OpenCloudError>>;

/**
 * Inputs to {@link executeWithRetry} bundled as an options object to keep the
 * function signature narrow.
 */
export interface ExecuteOptions {
	/** Fully-resolved retry config (post-merge). */
	readonly config: RetryResolvable;
	/** Client-level observability hooks. */
	readonly hooks: OpenCloudHooks;
	/** Transport callback. May be pre-wrapped by a rate-limit queue. */
	readonly send: SendFunc;
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
export async function executeWithRetry(
	request: HttpRequest,
	options: ExecuteOptions,
): Promise<Result<HttpResponse, OpenCloudError>> {
	const { config, hooks, send, sleep } = options;

	async function attempt(): Promise<Result<HttpResponse, OpenCloudError>> {
		hooks.onRequest?.(request);
		return send(request);
	}

	let result = await attempt();

	for (let retry = 0; retry < config.maxRetries; retry++) {
		if (result.success || !shouldRetry(result.err, config)) {
			return result;
		}

		const { err } = result;
		hooks.onRetry?.(retry + 1, err);
		const waitMs = computeRetryWaitMs(err, { attempt: retry, retryDelay: config.retryDelay });
		hooks.onRateLimit?.(waitMs);
		await sleep(waitMs);

		result = await attempt();
	}

	return result;
}
