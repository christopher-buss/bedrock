import type { RequestOptions } from "../../client/types.ts";
import type { LuauExecutionTask } from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { PollAbortedError } from "../../errors/poll-aborted.ts";
import { PollTimeoutError } from "../../errors/poll-timeout.ts";
import type { SleepFunc } from "../../internal/utils/sleep.ts";
import type { Result } from "../../types.ts";

/** Default total polling budget in milliseconds (5 minutes). */
export const DEFAULT_POLL_TIMEOUT_MS = 300_000;

/** One step of the default poll-cadence schedule. */
interface PollDelayTier {
	/** Delay in ms to wait between polls while within this tier. */
	readonly delayMs: number;
	/** Upper elapsed-time bound (exclusive) at which this tier stops applying. */
	readonly untilMs: number;
}

/** Steady-state delay once elapsed time reaches the final tier bound. */
const STEADY_POLL_DELAY_MS = 5_000;

/**
 * Fast-to-slow poll-cadence tiers keyed on elapsed wall-clock time. Elapsed
 * times at or beyond the last `untilMs` fall through to
 * {@link STEADY_POLL_DELAY_MS}.
 */
const DEFAULT_POLL_TIERS: ReadonlyArray<PollDelayTier> = [
	{ delayMs: 500, untilMs: 20_000 },
	{ delayMs: 1_000, untilMs: 60_000 },
];

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
	/** Returns the sleep duration given ms elapsed since polling started. Defaults to {@link defaultPollDelay}. */
	readonly pollDelay?: (elapsedMs: number) => number;
	/** When aborted, the loop returns {@link PollAbortedError} rather than continuing. */
	readonly signal?: AbortSignal;
	/** Total wall-clock budget in ms before the loop returns {@link PollTimeoutError}. */
	readonly timeoutMs?: number;
}

/**
 * Default poll cadence as a function of elapsed wall-clock time since
 * polling began. Polls quickly while a task is young so short runs resolve
 * snappily, then eases off so a long run leaves rate-limit headroom for
 * newer tasks: 0-20s is 500ms, 20-60s is 1000ms, 60s+ is 5000ms.
 *
 * @example
 * ```ts
 * import { defaultPollDelay } from "@bedrock-rbx/ocale/luau-execution";
 *
 * expect(defaultPollDelay(0)).toBe(500);
 * expect(defaultPollDelay(30_000)).toBe(1000);
 * expect(defaultPollDelay(120_000)).toBe(5000);
 * ```
 *
 * @param elapsedMs - Milliseconds elapsed since polling started.
 * @returns The delay in milliseconds to wait before the next poll.
 */
export function defaultPollDelay(elapsedMs: number): number {
	const tier = DEFAULT_POLL_TIERS.find((candidate) => elapsedMs < candidate.untilMs);
	return tier?.delayMs ?? STEADY_POLL_DELAY_MS;
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
 * `pollDelay(elapsedMs)` ms between iterations, until a terminal state
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
	const pollDelay = options.pollDelay ?? defaultPollDelay;
	const sig = options.signal;
	const startedAt = deps.now();
	if (sig?.aborted === true) {
		return abortedResult(sig);
	}

	let lastTask: LuauExecutionTask | undefined;
	for (;;) {
		const elapsedMs = deps.now() - startedAt;
		if (elapsedMs >= timeoutMs) {
			return { err: makeTimeout(lastTask, timeoutMs), success: false };
		}

		const iteration = await pollIteration({ delayMs: pollDelay(elapsedMs), deps, signal: sig });
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
