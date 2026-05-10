import type { RequestOptions } from "../../client/types.ts";
import type { LuauExecutionTask } from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { PollAbortedError } from "../../errors/poll-aborted.ts";
import { PollTimeoutError } from "../../errors/poll-timeout.ts";
import { defaultRetryDelay } from "../../internal/http/retry.ts";
import type { SleepFunc } from "../../internal/utils/sleep.ts";
import type { Result } from "../../types.ts";

/** Default total polling budget in milliseconds (5 minutes). */
export const DEFAULT_POLL_TIMEOUT_MS = 300_000;

/**
 * Injected dependencies for the deep-module polling loop. The `fetch`
 * callback is pre-bound by the wiring layer and closes over the task ref
 * and request options, keeping the core loop narrow.
 */
export interface PollDeps {
	/** Returns the current task or an error. Called on each loop iteration. */
	readonly fetch: () => Promise<Result<LuauExecutionTask, OpenCloudError>>;
	/** Returns the current wall-clock time in ms. */
	readonly now: () => number;
	/** Injectable sleep for deterministic tests. */
	readonly sleep: SleepFunc;
}

/** Public options accepted by `pollUntilDone` and `runUntilDone` on both client surfaces. */
export type PollUntilDoneOptions = PollOptions & RequestOptions;

/** Caller-supplied polling-loop options; all fields optional. */
interface PollOptions {
	/** Returns the sleep duration for a given zero-indexed attempt. Defaults to {@link defaultRetryDelay}. */
	readonly pollDelay?: (attempt: number) => number;
	/** When aborted, the loop returns {@link PollAbortedError} rather than continuing. */
	readonly signal?: AbortSignal;
	/** Total wall-clock budget in ms before the loop returns {@link PollTimeoutError}. */
	readonly timeoutMs?: number;
}

interface SleepWithAbortOptions {
	readonly ms: number;
	readonly signal: AbortSignal | undefined;
	readonly sleep: SleepFunc;
}

/**
 * Core polling loop. Calls `deps.fetch()` repeatedly, sleeping
 * `pollDelay(attempt)` ms between iterations, until a terminal state
 * is observed, the wall-clock budget is exhausted, or an `AbortSignal`
 * fires. Returns the terminal task on success.
 *
 * @param deps - Injected fetch, now, and sleep callbacks.
 * @param options - Optional poll delay, timeout, and abort signal.
 * @returns The terminal task, or an error if aborted, timed out, or the transport fails.
 */
export async function pollUntilDoneCore(
	deps: PollDeps,
	options: PollOptions = {},
): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
	const sig = options.signal;
	const startedAt = deps.now();

	if (sig?.aborted === true) {
		return { err: makeAborted(sig), success: false };
	}

	let lastTask: LuauExecutionTask | undefined;
	for (let attempt = 0; ; attempt += 1) {
		if (deps.now() - startedAt >= timeoutMs) {
			return { err: makeTimeout(lastTask, timeoutMs), success: false };
		}

		const fetchResult = await deps.fetch();
		if (!fetchResult.success) {
			return fetchResult;
		}

		lastTask = fetchResult.data;
		if (isTerminal(lastTask)) {
			return { data: lastTask, success: true };
		}

		const delay = (options.pollDelay ?? defaultRetryDelay)(attempt);
		if (await sleepWithAbort({ ms: delay, signal: sig, sleep: deps.sleep })) {
			return { err: makeAborted(sig), success: false };
		}
	}
}

function makeAborted(signal: AbortSignal | undefined): PollAbortedError {
	return new PollAbortedError("Polling was aborted", { reason: signal?.reason });
}

function makeTimeout(
	task: LuauExecutionTask | undefined,
	timeoutMs: number,
): PollTimeoutError<LuauExecutionTask> {
	return new PollTimeoutError(`Polling timed out after ${timeoutMs} ms`, {
		lastObservedTask: task,
		timeoutMs,
	});
}

function isTerminal(task: LuauExecutionTask): boolean {
	return task.state === "COMPLETE" || task.state === "FAILED" || task.state === "CANCELLED";
}

async function sleepWithAbort(options: SleepWithAbortOptions): Promise<boolean> {
	const { ms, signal, sleep } = options;
	if (signal === undefined) {
		await sleep(ms);
		return false;
	}

	if (signal.aborted) {
		return true;
	}

	const abortSignal = signal;
	const aborted = new Promise<true>((resolve) => {
		abortSignal.addEventListener("abort", () => {
			resolve(true);
		});
	});
	return Promise.race([sleep(ms).then(() => false as const), aborted]);
}
