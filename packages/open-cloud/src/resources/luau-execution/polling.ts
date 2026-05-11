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

const ABORTED = Symbol("poll-aborted");
type Aborted = typeof ABORTED;

interface AbortObserver {
	readonly cleanup: () => void;
	readonly promise: Promise<Aborted>;
}

interface SleepWithAbortOptions {
	readonly ms: number;
	readonly signal: AbortSignal | undefined;
	readonly sleep: SleepFunc;
}

type IterationOutcome =
	| { readonly done: false; readonly task: LuauExecutionTask }
	| { readonly done: true; readonly result: Result<LuauExecutionTask, OpenCloudError> };

interface PollIterationOptions {
	readonly delayMs: number;
	readonly deps: PollDeps;
	readonly signal: AbortSignal | undefined;
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
	const pollDelay = options.pollDelay ?? defaultRetryDelay;
	const sig = options.signal;
	const startedAt = deps.now();
	if (sig?.aborted === true) {
		return abortedResult(sig);
	}

	let lastTask: LuauExecutionTask | undefined;
	for (let attempt = 0; ; attempt += 1) {
		if (deps.now() - startedAt >= timeoutMs) {
			return { err: makeTimeout(lastTask, timeoutMs), success: false };
		}

		const iteration = await pollIteration({ delayMs: pollDelay(attempt), deps, signal: sig });
		if (iteration.done) {
			return iteration.result;
		}

		lastTask = iteration.task;
	}
}

function makeAborted(signal: AbortSignal | undefined): PollAbortedError {
	return new PollAbortedError("Polling was aborted", { reason: signal?.reason });
}

function abortedResult(signal: AbortSignal | undefined): Result<LuauExecutionTask, OpenCloudError> {
	return { err: makeAborted(signal), success: false };
}

function isTerminal(task: LuauExecutionTask): boolean {
	return task.state === "COMPLETE" || task.state === "FAILED" || task.state === "CANCELLED";
}

function abortObserver(signal: AbortSignal): AbortObserver {
	const { promise, resolve } = Promise.withResolvers<Aborted>();
	function onAbort(): void {
		resolve(ABORTED);
	}

	signal.addEventListener("abort", onAbort);
	function cleanup(): void {
		signal.removeEventListener("abort", onAbort);
	}

	return { cleanup, promise };
}

async function raceWithAbort<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
): Promise<Aborted | T> {
	if (signal === undefined) {
		return promise;
	}

	if (signal.aborted) {
		return ABORTED;
	}

	const observer = abortObserver(signal);
	try {
		return await Promise.race([promise, observer.promise]);
	} finally {
		observer.cleanup();
	}
}

async function sleepWithAbort(options: SleepWithAbortOptions): Promise<boolean> {
	const { ms, signal, sleep } = options;
	const raced = await raceWithAbort(sleep(ms), signal);
	return raced === ABORTED;
}

async function pollIteration(options: PollIterationOptions): Promise<IterationOutcome> {
	const { delayMs, deps, signal } = options;
	const fetchResult = await raceWithAbort(deps.fetch(), signal);
	if (fetchResult === ABORTED) {
		return { done: true, result: abortedResult(signal) };
	}

	if (!fetchResult.success) {
		return { done: true, result: fetchResult };
	}

	if (isTerminal(fetchResult.data)) {
		return { done: true, result: { data: fetchResult.data, success: true } };
	}

	if (await sleepWithAbort({ ms: delayMs, signal, sleep: deps.sleep })) {
		return { done: true, result: abortedResult(signal) };
	}

	return { done: false, task: fetchResult.data };
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
