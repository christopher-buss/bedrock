import type { RequestOptions } from "../../client/types.ts";
import {
	GET_SPEC,
	SUBMIT_HEAD_SPEC,
	SUBMIT_VERSION_SPEC,
} from "../../domains/cloud-v2/luau-execution-tasks/specs.ts";
import type {
	LuauExecutionTask,
	LuauExecutionTaskRef,
	SubmitAtHeadParameters,
	SubmitAtVersionParameters,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { observeAdmissionWaitAsync } from "../../internal/http/admission-wait.ts";
import { waitDeadlineFailure } from "../../internal/http/request-deadline.ts";
import type { ResourceClient } from "../../internal/resource-client.ts";
import { raceWithAbortAsync } from "../../internal/utils/abort.ts";
import type { Result } from "../../types.ts";
import { capacityErrorFrom, LuauExecutionCapacityError, luauTaskRefKey } from "./capacity-error.ts";
import { defaultPollDelay, isTerminalTask, type PollUntilDoneOptions } from "./polling.ts";

const MAX_CAPACITY_WAIT_MS = 2_147_483_647;

/**
 * Per-request options for submitting a Luau execution task.
 *
 * @example
 *
 * ```ts
 * import type { LuauExecutionSubmitOptions } from "@bedrock-rbx/ocale/luau-execution";
 *
 * const options: LuauExecutionSubmitOptions = { capacityWaitMs: 60_000 };
 * expect(options.capacityWaitMs).toBe(60_000);
 * ```
 *
 * @since 0.3.2
 */
export interface LuauExecutionSubmitOptions extends RequestOptions {
	/**
	 * Maximum milliseconds to spend waiting for occupied place capacity, from 1
	 * through 2,147,483,647. Supplying this value opts the submission into
	 * capacity-aware admission.
	 */
	readonly capacityWaitMs?: number;
}

/**
 * Per-request capacity and polling options for submitting and awaiting a Luau
 * execution task.
 *
 * @since 0.3.2
 */
export type LuauExecutionRunOptions = LuauExecutionSubmitOptions & PollUntilDoneOptions;

interface CapacitySubmitCall {
	readonly inner: ResourceClient;
	readonly options: LuauExecutionSubmitOptions | undefined;
	readonly parameters: SubmitAtHeadParameters | SubmitAtVersionParameters;
}

interface SubmitOnceCall extends CapacitySubmitCall {
	readonly options: RequestOptions;
	readonly refineError?: ((error: OpenCloudError) => OpenCloudError) | undefined;
}

interface ObserveBlockersCall {
	readonly blockers: ReadonlyArray<LuauExecutionTaskRef>;
	readonly inner: ResourceClient;
	readonly options: RequestOptions;
}

interface CapacityWaitCall extends ObserveBlockersCall {
	readonly capacityError: LuauExecutionCapacityError;
	readonly deadlineAt: number;
	readonly startedAt: number;
}

interface CapacityAdmissionCall {
	readonly callerSignal: AbortSignal | undefined;
	readonly capacityError: LuauExecutionCapacityError;
	readonly deadlineAt: number;
	readonly options: RequestOptions;
	readonly startedAt: number;
	readonly submitCall: SubmitOnceCall;
}

interface CapacitySleepCall {
	readonly inner: ResourceClient;
	readonly options: RequestOptions;
	readonly waitMs: number;
}

interface CapacityRetryCall {
	readonly callerSignal: AbortSignal | undefined;
	readonly current: LuauExecutionCapacityError;
	readonly options: RequestOptions;
	readonly submitCall: SubmitOnceCall;
}

type CapacityRetryDecision =
	| { readonly capacityError: LuauExecutionCapacityError; readonly continue: true }
	| {
			readonly continue: false;
			readonly result: Result<LuauExecutionTask, OpenCloudError>;
	  };

/**
 * Submits through capacity admission when the caller opts in.
 *
 * @param call - Resource client, submit parameters, and per-request options.
 * @returns The submitted task or the failure that stopped admission.
 */
export async function submitWithCapacityAsync({
	inner,
	options,
	parameters,
}: CapacitySubmitCall): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	const { capacityWaitMs, ...requestOptions } = options ?? {};
	if (capacityWaitMs === undefined) {
		return submitOnceAsync({ inner, options: requestOptions, parameters });
	}

	function refineError(error: OpenCloudError): OpenCloudError {
		return capacityErrorFrom(error, parameters) ?? error;
	}

	const submitCall = { inner, options: requestOptions, parameters, refineError };
	const first = await submitOnceAsync(submitCall);
	if (!isCapacityFailure(first)) {
		return first;
	}

	if (
		!Number.isFinite(capacityWaitMs) ||
		capacityWaitMs < 1 ||
		capacityWaitMs > MAX_CAPACITY_WAIT_MS
	) {
		return first;
	}

	return admitWithinCapacityAsync({
		capacityError: first.err,
		options: requestOptions,
		submitCall,
		waitMs: capacityWaitMs,
	});
}

function isCapacityFailure(
	result: Result<LuauExecutionTask, OpenCloudError>,
): result is { readonly err: LuauExecutionCapacityError; readonly success: false } {
	return !result.success && result.err instanceof LuauExecutionCapacityError;
}

async function submitOnceAsync({
	inner,
	options,
	parameters,
	refineError,
}: SubmitOnceCall): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	return "versionId" in parameters
		? inner.executeAsync({ options, parameters, refineError, spec: SUBMIT_VERSION_SPEC })
		: inner.executeAsync({ options, parameters, refineError, spec: SUBMIT_HEAD_SPEC });
}

function capacityBoundAborted(
	options: RequestOptions,
	callerSignal: AbortSignal | undefined,
): boolean {
	return options.signal?.aborted === true && callerSignal?.aborted !== true;
}

async function observeBlockersAsync({
	blockers,
	inner,
	options,
}: ObserveBlockersCall): Promise<Result<LuauExecutionTaskRef | undefined, OpenCloudError>> {
	for (const blocker of blockers) {
		const observed = await inner.executeAsync({
			options,
			parameters: { ref: blocker, view: "BASIC" as const },
			spec: GET_SPEC,
		});
		if (!observed.success) {
			return observed;
		}

		if (isTerminalTask(observed.data)) {
			return { data: blocker, success: true };
		}
	}

	return { data: undefined, success: true };
}

async function sleepForCapacityAsync({ inner, options, waitMs }: CapacitySleepCall): Promise<void> {
	await observeAdmissionWaitAsync({
		durationMs: waitMs,
		observer: options.onAdmissionWait,
		reason: "operation-capacity",
		waitAsync: async () => {
			return raceWithAbortAsync(
				async () => inner.sleep(waitMs, options.signal),
				options.signal,
			);
		},
	});
}

async function observeWithinCapacityAsync({
	blockers,
	capacityError,
	deadlineAt,
	inner,
	options,
	startedAt,
}: CapacityWaitCall): Promise<Result<LuauExecutionTaskRef, OpenCloudError>> {
	while (Date.now() < deadlineAt) {
		const observed = await observeBlockersAsync({ blockers, inner, options });
		if (!observed.success) {
			return observed;
		}

		if (observed.data !== undefined) {
			return { data: observed.data, success: true };
		}

		const elapsedMs = Date.now() - startedAt;
		const pollWaitMs = defaultPollDelay(elapsedMs);
		const deadlineFailure = waitDeadlineFailure({
			cause: capacityError,
			deadlineMs: options.deadlineMs,
			waitMs: pollWaitMs,
			waitReason: "operation-capacity",
		});
		if (deadlineFailure !== undefined) {
			return { err: deadlineFailure, success: false };
		}

		const waitMs = Math.min(pollWaitMs, deadlineAt - Date.now());
		await sleepForCapacityAsync({ inner, options, waitMs });
	}

	return { err: capacityError, success: false };
}

function hasSameBlockers(
	left: LuauExecutionCapacityError,
	right: LuauExecutionCapacityError,
): boolean {
	if (left.blockers.length !== right.blockers.length) {
		return false;
	}

	const rightKeys = new Set(right.blockers.map(luauTaskRefKey));
	return left.blockers.every((blocker) => rightKeys.has(luauTaskRefKey(blocker)));
}

async function retryAfterCapacityAsync({
	callerSignal,
	current,
	options,
	submitCall,
}: CapacityRetryCall): Promise<CapacityRetryDecision> {
	const retried = await submitOnceAsync(submitCall);
	if (!retried.success && capacityBoundAborted(options, callerSignal)) {
		return { continue: false, result: { err: current, success: false } };
	}

	if (!isCapacityFailure(retried) || hasSameBlockers(current, retried.err)) {
		return { continue: false, result: retried };
	}

	return { capacityError: retried.err, continue: true };
}

async function runCapacityAdmissionAsync({
	callerSignal,
	capacityError,
	deadlineAt,
	options,
	startedAt,
	submitCall,
}: CapacityAdmissionCall): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	const cleared = new Set<string>();
	let current = capacityError;
	while (true) {
		const pending = current.blockers.filter((blocker) => !cleared.has(luauTaskRefKey(blocker)));
		if (pending.length === 0) {
			return { err: current, success: false };
		}

		const observed = await observeWithinCapacityAsync({
			blockers: pending,
			capacityError: current,
			deadlineAt,
			inner: submitCall.inner,
			options,
			startedAt,
		});
		if (!observed.success) {
			return capacityBoundAborted(options, callerSignal)
				? { err: current, success: false }
				: observed;
		}

		cleared.add(luauTaskRefKey(observed.data));
		const retry = await retryAfterCapacityAsync({ callerSignal, current, options, submitCall });
		if (!retry.continue) {
			return retry.result;
		}

		current = retry.capacityError;
	}
}

async function admitWithinCapacityAsync({
	capacityError,
	options,
	submitCall,
	waitMs,
}: {
	readonly capacityError: LuauExecutionCapacityError;
	readonly options: RequestOptions;
	readonly submitCall: SubmitOnceCall;
	readonly waitMs: number;
}): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	const deadline = new AbortController();
	const timer = setTimeout(() => {
		deadline.abort();
	}, waitMs);
	const signal =
		options.signal === undefined
			? deadline.signal
			: AbortSignal.any([options.signal, deadline.signal]);
	const startedAt = Date.now();
	try {
		return await runCapacityAdmissionAsync({
			callerSignal: options.signal,
			capacityError,
			deadlineAt: startedAt + waitMs,
			options: { ...options, signal },
			startedAt,
			submitCall: { ...submitCall, options: { ...submitCall.options, signal } },
		});
	} finally {
		clearTimeout(timer);
	}
}
