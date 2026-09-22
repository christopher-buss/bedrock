import type { AdmissionWaitReason } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { RequestAbortedError } from "../../errors/request-aborted.ts";
import {
	RequestDeadlineExceededError,
	type RequestDeadlineExceededErrorOptions,
} from "../../errors/request-deadline-exceeded.ts";

const DEADLINE_ELAPSED = Symbol("request deadline elapsed");

/**
 * Request-lifecycle signals derived from caller cancellation and a deadline.
 */
export interface RequestLifecycle {
	/** Caller-supplied absolute deadline, as Unix epoch milliseconds. */
	readonly deadlineMs: number | undefined;
	/** Signal owned by the deadline, used to classify its expiry. */
	readonly deadlineSignal: AbortSignal | undefined;
	/** Caller and deadline signals composed for every stage of the request. */
	readonly signal: AbortSignal | undefined;
}

interface WaitDeadlineInputs {
	readonly cause?: Error | undefined;
	readonly deadlineMs: number | undefined;
	readonly waitMs: number;
	readonly waitReason: AdmissionWaitReason;
}

/**
 * Resolves one signal that spans the whole logical request.
 *
 * @param deadlineMs - Absolute deadline, as Unix epoch milliseconds.
 * @param callerSignal - Optional caller cancellation signal.
 * @returns Signals that span and classify the logical request.
 */
export function requestLifecycle(
	deadlineMs: number | undefined,
	callerSignal: AbortSignal | undefined,
): RequestLifecycle {
	if (deadlineMs === undefined) {
		return { deadlineMs, deadlineSignal: undefined, signal: callerSignal };
	}

	const remainingMs = deadlineMs - Date.now();
	const deadlineSignal =
		remainingMs <= 0 ? AbortSignal.abort(DEADLINE_ELAPSED) : deadlineTimeout(remainingMs);
	const signal =
		callerSignal === undefined
			? deadlineSignal
			: AbortSignal.any([callerSignal, deadlineSignal]);
	return { deadlineMs, deadlineSignal, signal };
}

/**
 * Returns a typed failure when the deadline signal ended the request.
 *
 * @param lifecycle - Signals and timestamp for the logical request.
 * @returns A deadline failure, or `undefined` when another signal won.
 */
export function elapsedDeadlineFailure({
	deadlineMs,
	deadlineSignal,
	signal,
}: RequestLifecycle): RequestDeadlineExceededError | undefined {
	if (
		deadlineMs === undefined ||
		deadlineSignal?.aborted !== true ||
		!Object.is(signal?.reason, deadlineSignal.reason)
	) {
		return undefined;
	}

	return new RequestDeadlineExceededError("Request deadline elapsed", {
		deadlineMs,
		remainingMs: 0,
	});
}

/**
 * Reclassifies an internal abort when the request deadline supplied its signal.
 *
 * @param error - Error returned by the request pipeline.
 * @param lifecycle - Signals and timestamp for the logical request.
 * @returns A deadline failure, or `undefined` for other failures.
 */
export function deadlineFailureFromError(
	error: OpenCloudError,
	lifecycle: RequestLifecycle,
): RequestDeadlineExceededError | undefined {
	return error instanceof RequestAbortedError ? elapsedDeadlineFailure(lifecycle) : undefined;
}

/**
 * Refuses a known admission wait that cannot fit before the deadline.
 *
 * @param inputs - Deadline, wait duration, reason, and optional cause.
 * @returns A typed refusal, or `undefined` when the wait fits.
 */
export function waitDeadlineFailure({
	cause,
	deadlineMs,
	waitMs,
	waitReason,
}: WaitDeadlineInputs): RequestDeadlineExceededError | undefined {
	if (deadlineMs === undefined) {
		return undefined;
	}

	const now = Date.now();
	const remainingMs = Math.max(0, deadlineMs - now);
	if (now < deadlineMs && waitMs <= remainingMs) {
		return undefined;
	}

	const options: RequestDeadlineExceededErrorOptions = {
		cause,
		deadlineMs,
		remainingMs,
		waitMs,
		waitReason,
	};
	return new RequestDeadlineExceededError(waitMessage(waitMs, remainingMs), options);
}

function deadlineTimeout(remainingMs: number): AbortSignal {
	return AbortSignal.timeout(Math.ceil(remainingMs));
}

function waitMessage(waitMs: number, remainingMs: number): string {
	return `Admission wait would take ${waitMs / 1000}s; ${remainingMs / 1000}s remain before the request deadline`;
}
