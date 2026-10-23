import type { RequestOptions } from "../../client/types.ts";
import type { LuauExecutionTask } from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { PollAbortedError } from "../../errors/poll-aborted.ts";
import { PollTimeoutError } from "../../errors/poll-timeout.ts";
import { RequestDeadlineExceededError } from "../../errors/request-deadline-exceeded.ts";
import { MAX_ABORT_TIMEOUT_MS } from "../../internal/http/request-deadline.ts";
import { TRANSIENT_TRANSPORT_CODES } from "../../internal/http/retry.ts";
import { ABORTED, raceWithAbortAsync } from "../../internal/utils/abort.ts";
import { findErrorCode } from "../../internal/utils/find-error-code.ts";
import type { SleepFunc } from "../../internal/utils/sleep.ts";
import type { Result } from "../../types.ts";

/** Default total polling budget in milliseconds (5 minutes). */
export const DEFAULT_POLL_TIMEOUT_MS = 300_000;

/** One step of the default poll-cadence schedule. */
interface PollDelayTier {
	/** Delay in ms to wait between polls while within this tier. */
	readonly delayMs: number;
	/**
	 * Upper elapsed-time bound (exclusive) at which this tier stops applying.
	 */
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
 * endpoint, so it bails in seconds rather than spinning out the wall-clock
 * budget.
 */
export const DEFAULT_POLL_FAILURE_CAP = 3;

/**
 * Injected dependencies for the deep-module polling loop. The `fetch`
 * callback is pre-bound by the wiring layer and closes over the task ref
 * and request options, keeping the core loop narrow.
 */
export interface PollDependencies {
	/**
	 * Returns the current task or an error. Called on each loop iteration with
	 * the absolute request deadline (epoch ms) that bounds the request, or
	 * `undefined` when nothing bounds it.
	 */
	readonly fetch: (
		deadlineMs: number | undefined,
	) => Promise<Result<LuauExecutionTask, OpenCloudError>>;
	/** Returns the current wall-clock time in ms. */
	readonly now: () => number;
	/** Injectable sleep for deterministic tests. */
	readonly sleep: SleepFunc;
	/**
	 * Time the budget opened, when an earlier step (a submit) already spent
	 * part of it. Defaults to `now()` at loop start.
	 */
	readonly startedAt?: number;
}

/** The opened poll budget: its window and the deadline each request gets. */
export interface PollBudget {
	/** Absolute end of the budget, as epoch ms. May be infinite. */
	readonly budgetDeadlineMs: number;
	/** Deadline to pass to each request, or `undefined` when unbounded. */
	readonly requestDeadlineMs: number | undefined;
	/** Total budget in ms. */
	readonly timeoutMs: number;
}

/**
 * Public options accepted by `pollUntilDone` and `runUntilDone` on both client
 * surfaces.
 *
 * @since 0.1.0
 */
export type PollUntilDoneOptions = PollOptions & RequestOptions;

/** Caller-supplied polling-loop options; all fields optional. */
interface PollOptions {
	/**
	 * Consecutive transient transport failures tolerated before the loop gives
	 * up. Defaults to {@link DEFAULT_POLL_FAILURE_CAP}. A successful poll
	 * resets the count.
	 */
	readonly maxConsecutivePollFailures?: number;
	/**
	 * Returns the sleep duration given ms elapsed since polling started.
	 * Defaults to {@link defaultPollDelay}.
	 */
	readonly pollDelay?: (elapsedMs: number) => number;
	/**
	 * When aborted, the loop returns {@link PollAbortedError} rather than
	 * continuing.
	 */
	readonly signal?: AbortSignal;
	/**
	 * Total wall-clock budget in ms before the loop returns {@link
	 * PollTimeoutError}. It also bounds each in-flight request through the
	 * request deadline (the earlier of the budget end and any `deadlineMs`),
	 * so a hanging request ends at the budget. For `runUntilDone` the budget
	 * opens before the submit and covers it too.
	 */
	readonly timeoutMs?: number;
}

/** Core loop options: the poll options plus the caller's request deadline. */
type CorePollOptions = Pick<RequestOptions, "deadlineMs"> & PollOptions;

interface ResolvedPollOptions {
	readonly maxFailures: number;
	readonly pollDelay: (elapsedMs: number) => number;
	readonly signal: AbortSignal | undefined;
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
	readonly budget: PollBudget;
	readonly maxFailures: number;
	readonly signal: AbortSignal | undefined;
	readonly state: LoopState;
}

/**
 * Opens the poll budget at `startedAt`. Each request gets the earlier of the
 * budget deadline and the caller's own `deadlineMs`. A non-finite budget
 * passes only the caller's deadline, since the transport rejects a
 * non-finite one.
 *
 * @param startedAt - Time the budget opened, as epoch ms.
 * @param options - The caller's `timeoutMs` and `deadlineMs`.
 * @returns The budget window and the per-request deadline.
 */
export function openPollBudget(
	startedAt: number,
	options: Pick<PollUntilDoneOptions, "deadlineMs" | "timeoutMs">,
): PollBudget {
	const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
	const budgetDeadlineMs = startedAt + timeoutMs;
	const callerDeadlineMs = options.deadlineMs;
	if (!Number.isFinite(budgetDeadlineMs)) {
		return { budgetDeadlineMs, requestDeadlineMs: callerDeadlineMs, timeoutMs };
	}

	const requestDeadlineMs =
		callerDeadlineMs === undefined
			? budgetDeadlineMs
			: Math.min(callerDeadlineMs, budgetDeadlineMs);
	return { budgetDeadlineMs, requestDeadlineMs, timeoutMs };
}

/**
 * Maps a request failure caused by the budget deadline to
 * {@link PollTimeoutError}. Any other failure, including one from the
 * caller's own earlier deadline, is returned unchanged. A caller abort wins
 * over the budget, so the failure is also returned unchanged when the
 * caller's signal has fired.
 *
 * @param error - The failure a submit or poll request returned.
 * @param context - The opened budget, the last task observed, if any, and
 *   the caller's signal.
 * @returns The poll timeout, or the original error.
 */
export function budgetFailure(
	error: OpenCloudError,
	context: {
		budget: PollBudget;
		lastTask: LuauExecutionTask | undefined;
		signal: AbortSignal | undefined;
	},
): OpenCloudError {
	if (!isBudgetDeadline(error, context.budget) || context.signal?.aborted === true) {
		return error;
	}

	return makeTimeout(context.lastTask, { cause: error, timeoutMs: context.budget.timeoutMs });
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
 * surface a retryable status instead. A budget longer than a timer can hold,
 * such as `Infinity`, is capped at the longest delay the transport accepts.
 *
 * @template TOptions - The concrete polling option shape to preserve.
 * @param options - The caller's poll and per-request options.
 * @returns The options with `timeout` filled from the budget when it was unset.
 */
export function withBudgetRequestTimeout<TOptions extends PollUntilDoneOptions>(
	options: TOptions,
): TOptions & { readonly timeout: number } {
	const budgetMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
	const timeout = options.timeout ?? Math.min(budgetMs, MAX_ABORT_TIMEOUT_MS);
	return { ...options, timeout };
}

/**
 * Reports whether a Luau task can no longer change execution state.
 *
 * @param task - Task whose state should be classified.
 * @returns Whether the task is complete, failed, or cancelled.
 */
export function isTerminalTask(task: LuauExecutionTask): boolean {
	return task.state === "COMPLETE" || task.state === "FAILED" || task.state === "CANCELLED";
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
export async function pollUntilDoneCoreAsync(
	deps: PollDependencies,
	options: CorePollOptions = {},
): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	const { maxFailures, pollDelay, signal } = resolvePollOptions(options);
	if (signal?.aborted === true) {
		return abortedResult(signal);
	}

	const startedAt = deps.startedAt ?? deps.now();
	const budget = openPollBudget(startedAt, options);
	let state: LoopState = { consecutiveFailures: 0, lastTask: undefined };
	for (;;) {
		const elapsedMs = deps.now() - startedAt;
		if (elapsedMs >= budget.timeoutMs) {
			return { err: makeTimeout(state.lastTask, budget), success: false };
		}

		const outcome = await fetchOnceAsync(deps, { budget, signal });
		const action = applyOutcome(outcome, { budget, maxFailures, signal, state });
		if (action.kind === "return") {
			return action.result;
		}

		({ state } = action);
		const sleepWasAborted = await sleepWithAbortAsync({
			ms: pollDelay(elapsedMs),
			signal,
			sleep: deps.sleep,
		});
		if (sleepWasAborted) {
			return abortedResult(signal);
		}
	}
}

/**
 * Describes why the budget ended. A wait the transport refused up front
 * (one that carries `waitMs`) ends the poll before `timeoutMs` has elapsed,
 * so its message reports the budget left rather than an elapsed timeout.
 *
 * @param cause - The budget deadline failure, if a request reported one.
 * @param timeoutMs - The total poll budget in ms.
 * @returns The elapsed-timeout wording, or the budget left and the refused wait.
 */
function timeoutMessage(
	cause: RequestDeadlineExceededError | undefined,
	timeoutMs: number,
): string {
	if (cause?.waitMs === undefined) {
		return `Polling timed out after ${timeoutMs} ms`;
	}

	return `Polling stopped with ${cause.remainingMs} ms of the ${timeoutMs} ms budget left: a required ${cause.waitMs} ms wait would exceed it`;
}

function makeTimeout(
	task: LuauExecutionTask | undefined,
	{ cause, timeoutMs }: { cause?: RequestDeadlineExceededError; timeoutMs: number },
): PollTimeoutError<LuauExecutionTask> {
	return new PollTimeoutError(timeoutMessage(cause, timeoutMs), {
		...(cause === undefined ? {} : { cause }),
		lastObservedTask: task,
		timeoutMs,
	});
}

function isBudgetDeadline(
	error: OpenCloudError,
	budget: PollBudget,
): error is RequestDeadlineExceededError {
	return (
		error instanceof RequestDeadlineExceededError &&
		error.deadlineMs === budget.budgetDeadlineMs
	);
}

function resolvePollOptions(options: PollOptions): ResolvedPollOptions {
	return {
		maxFailures: options.maxConsecutivePollFailures ?? DEFAULT_POLL_FAILURE_CAP,
		pollDelay: options.pollDelay ?? defaultPollDelay,
		signal: options.signal,
	};
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
function applyOutcome(
	outcome: FetchOutcome,
	{ budget, maxFailures, signal, state }: OutcomeContext,
): LoopAction {
	switch (outcome.kind) {
		case "aborted": {
			return { kind: "return", result: abortedResult(signal) };
		}
		case "failed": {
			if (signal?.aborted === true && isBudgetDeadline(outcome.error, budget)) {
				return { kind: "return", result: abortedResult(signal) };
			}

			const err = budgetFailure(outcome.error, { budget, lastTask: state.lastTask, signal });
			return { kind: "return", result: { err, success: false } };
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

async function sleepWithAbortAsync({ ms, signal, sleep }: SleepWithAbortOptions): Promise<boolean> {
	return (await raceWithAbortAsync(async () => sleep(ms, signal), signal)) === ABORTED;
}

/**
 * A failed poll is worth re-polling only when it is a `NetworkError` carrying
 * a known transient transport code. A self-aborted request timeout has no
 * `code`, and an API response (4xx/5xx) is authoritative, so both abort the
 * loop rather than being re-polled. Transient-ness is classified against the
 * canonical `TRANSIENT_TRANSPORT_CODES` set; this is the loop's own tolerance
 * dimension, distinct from the per-request `retryableTransportCodes` override
 * (which governs request-level retries inside each poll). Loop tolerance is
 * bounded separately by `maxConsecutivePollFailures`.
 *
 * A 2xx whose body would not parse is deliberately not re-polled here: it is
 * recovered a layer down, by the request-level retry that
 * `RESPONSE_UNPARSEABLE` puts in every idempotent policy. Reaching this
 * function means that retry budget is already spent, and a fourth read of the
 * same body is not a different answer.
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

async function fetchOnceAsync(
	dependencies: PollDependencies,
	{ budget, signal }: { budget: PollBudget; signal: AbortSignal | undefined },
): Promise<FetchOutcome> {
	const fetchResult = await raceWithAbortAsync(
		async () => dependencies.fetch(budget.requestDeadlineMs),
		signal,
	);
	if (fetchResult === ABORTED) {
		return { kind: "aborted" };
	}

	if (!fetchResult.success) {
		return isTransientTransport(fetchResult.err)
			? { error: fetchResult.err, kind: "transient" }
			: { error: fetchResult.err, kind: "failed" };
	}

	return isTerminalTask(fetchResult.data)
		? { kind: "terminal", task: fetchResult.data }
		: { kind: "pending", task: fetchResult.data };
}
