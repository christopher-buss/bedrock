import type { RequestOptions } from "../../client/types.ts";
import type { LuauExecutionTask } from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { PollAbortedError } from "../../errors/poll-aborted.ts";
import { PollTimeoutError } from "../../errors/poll-timeout.ts";
import { TRANSIENT_TRANSPORT_CODES } from "../../internal/http/retry.ts";
import { findErrorCode } from "../../internal/utils/find-error-code.ts";
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
 * Default poll cadence as a function of elapsed wall-clock time since
 * polling began. Polls quickly while a task is young so short runs resolve
 * snappily, then eases off so a long run leaves rate-limit headroom for
 * newer tasks: 0-20s is 500ms, 20-60s is 1000ms, 60s+ is 5000ms.
 *
 * @since 0.1.0
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

/**
 * Default number of consecutive transport failures tolerated before the poll
 * loop gives up. With per-request retries already absorbing isolated blips,
 * three consecutive loop-level failures signals a genuinely unreachable
 * endpoint, so it bails in seconds rather than spinning out the wall-clock budget.
 */
export const DEFAULT_POLL_FAILURE_CAP = 3;

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

/**
 * Public options accepted by `pollUntilDone` and `runUntilDone` on both client surfaces.
 *
 * @since 0.1.0
 */
export type PollUntilDoneOptions = PollOptions & RequestOptions;

/** Caller-supplied polling-loop options; all fields optional. */
interface PollOptions {
	/**
	 * Consecutive transient transport failures tolerated before the loop gives
	 * up. Defaults to {@link DEFAULT_POLL_FAILURE_CAP}. A successful poll resets
	 * the count.
	 */
	readonly maxConsecutivePollFailures?: number;
	/** Returns the sleep duration given ms elapsed since polling started. Defaults to {@link defaultPollDelay}. */
	readonly pollDelay?: (elapsedMs: number) => number;
	/** When aborted, the loop returns {@link PollAbortedError} rather than continuing. */
	readonly signal?: AbortSignal;
	/** Total wall-clock budget in ms before the loop returns {@link PollTimeoutError}. */
	readonly timeoutMs?: number;
}

/**
 * Defaults the per-request `timeout` to the effective poll budget when the
 * caller has not set one. A luau-execution submit and each poll `get` normally
 * answer in well under a second (the submit endpoint enqueues the task without
 * waiting for it to run), so the only job of a per-request deadline here is to
 * bound a black-hole connection. Leaving these requests on the client-wide 30s
 * default (tuned for snappy CRUD) turns a slow-but-alive backend into a
 * self-abort, an error the retry layer never retries by construction, before
 * the loop's wall-clock budget is ever consulted. Deriving the deadline from
 * `timeoutMs` keeps a single request alive exactly as long as the caller
 * already agreed to wait for the whole operation, so the backend can answer or
 * surface a retryable status instead.
 *
 * @param options - The caller's poll and per-request options.
 * @returns The options with `timeout` filled from the budget when it was unset.
 */
export function withBudgetRequestTimeout(options: PollUntilDoneOptions): PollUntilDoneOptions {
	if (options.timeout !== undefined) {
		return options;
	}

	return { ...options, timeout: options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS };
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

type FetchOutcome =
	| { readonly error: NetworkError; readonly kind: "transient" }
	| { readonly error: OpenCloudError; readonly kind: "failed" }
	| { readonly kind: "aborted" }
	| { readonly kind: "pending"; readonly task: LuauExecutionTask }
	| { readonly kind: "terminal"; readonly task: LuauExecutionTask };

/** Mutable-per-iteration loop state threaded through {@link applyOutcome}. */
interface LoopState {
	readonly consecutiveFailures: number;
	readonly lastTask: LuauExecutionTask | undefined;
}

type LoopAction =
	| { readonly kind: "continue"; readonly state: LoopState }
	| { readonly kind: "return"; readonly result: Result<LuauExecutionTask, OpenCloudError> };

/** Per-iteration inputs to {@link applyOutcome}. */
interface OutcomeContext {
	readonly maxFailures: number;
	readonly signal: AbortSignal | undefined;
	readonly state: LoopState;
}

/**
 * Core polling loop. Calls `deps.fetch()` repeatedly, sleeping
 * `pollDelay(elapsedMs)` ms between iterations, until a terminal state
 * is observed, the wall-clock budget is exhausted, or an `AbortSignal`
 * fires. A transient transport failure ({@link NetworkError}) is tolerated
 * and the loop continues, giving up only after `maxConsecutivePollFailures`
 * consecutive failures; any other failure aborts immediately, since an API
 * response (a 404 for a vanished task, a 403) means there is nothing left to
 * poll. A successful poll resets the failure count.
 *
 * @param deps - Injected fetch, now, and sleep callbacks.
 * @param options - Optional poll delay, timeout, failure cap, and abort signal.
 * @returns The terminal task, or an error if aborted, timed out, or the transport keeps failing.
 */
export async function pollUntilDoneCore(
	deps: PollDeps,
	options: PollOptions = {},
): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
	const pollDelay = options.pollDelay ?? defaultPollDelay;
	const maxFailures = options.maxConsecutivePollFailures ?? DEFAULT_POLL_FAILURE_CAP;
	const sig = options.signal;
	const startedAt = deps.now();
	if (sig?.aborted === true) {
		return abortedResult(sig);
	}

	let state: LoopState = { consecutiveFailures: 0, lastTask: undefined };
	for (;;) {
		const elapsedMs = deps.now() - startedAt;
		if (elapsedMs >= timeoutMs) {
			return { err: makeTimeout(state.lastTask, timeoutMs), success: false };
		}

		const outcome = await fetchOnce(deps, sig);
		const action = applyOutcome(outcome, { maxFailures, signal: sig, state });
		if (action.kind === "return") {
			return action.result;
		}

		({ state } = action);
		if (await sleepWithAbort({ ms: pollDelay(elapsedMs), signal: sig, sleep: deps.sleep })) {
			return abortedResult(sig);
		}
	}
}

function makeAborted(signal: AbortSignal | undefined): PollAbortedError {
	return new PollAbortedError("Polling was aborted", { reason: signal?.reason });
}

function abortedResult(signal: AbortSignal | undefined): Result<LuauExecutionTask, OpenCloudError> {
	return { err: makeAborted(signal), success: false };
}

/**
 * Maps a single fetch outcome to the next loop action. Terminal, failed, and
 * aborted outcomes return immediately; a transient transport failure advances
 * the consecutive-failure count and returns once it reaches `maxFailures`; a
 * pending task resets the count and continues.
 *
 * @param outcome - The classified result of one poll fetch.
 * @param context - The loop state, failure cap, and abort signal.
 * @returns Whether to return a final Result or continue with updated state.
 */
function applyOutcome(outcome: FetchOutcome, context: OutcomeContext): LoopAction {
	const { maxFailures, signal, state } = context;
	switch (outcome.kind) {
		case "aborted": {
			return { kind: "return", result: abortedResult(signal) };
		}
		case "failed": {
			return { kind: "return", result: { err: outcome.error, success: false } };
		}
		case "pending": {
			return { kind: "continue", state: { consecutiveFailures: 0, lastTask: outcome.task } };
		}
		case "terminal": {
			return { kind: "return", result: { data: outcome.task, success: true } };
		}
		case "transient": {
			const consecutiveFailures = state.consecutiveFailures + 1;
			if (consecutiveFailures >= maxFailures) {
				return { kind: "return", result: { err: outcome.error, success: false } };
			}

			return { kind: "continue", state: { consecutiveFailures, lastTask: state.lastTask } };
		}
	}
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

/**
 * A failed poll is worth re-polling only when it is a `NetworkError` carrying a
 * known transient transport code. A self-aborted request timeout has no
 * `code`, and an API response (4xx/5xx) is authoritative, so both abort the
 * loop rather than being re-polled. Transient-ness is classified against the
 * canonical `TRANSIENT_TRANSPORT_CODES` set; this is the loop's own tolerance
 * dimension, distinct from the per-request `retryableTransportCodes` override
 * (which governs request-level retries inside each poll). Loop tolerance is
 * bounded separately by `maxConsecutivePollFailures`.
 *
 * @param error - The error returned by a failed poll.
 * @returns `true` when the loop should tolerate and re-poll.
 */
function isTransientTransport(error: OpenCloudError): error is NetworkError {
	if (!(error instanceof NetworkError)) {
		return false;
	}

	const code = findErrorCode(error);
	return code !== undefined && TRANSIENT_TRANSPORT_CODES.includes(code);
}

async function fetchOnce(deps: PollDeps, signal: AbortSignal | undefined): Promise<FetchOutcome> {
	const fetchResult = await raceWithAbort(deps.fetch(), signal);
	if (fetchResult === ABORTED) {
		return { kind: "aborted" };
	}

	if (!fetchResult.success) {
		return isTransientTransport(fetchResult.err)
			? { error: fetchResult.err, kind: "transient" }
			: { error: fetchResult.err, kind: "failed" };
	}

	return isTerminal(fetchResult.data)
		? { kind: "terminal", task: fetchResult.data }
		: { kind: "pending", task: fetchResult.data };
}
