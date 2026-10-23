import type { RequestOptions } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";
import { withCredentialSnapshot } from "../credential-snapshot.ts";
import { requestAbortedError } from "../utils/abort.ts";
import type { AdmissionWaitContext } from "./admission-wait.ts";
import {
	elapsedDeadlineFailure,
	requestLifecycle,
	type RequestLifecycle,
} from "./request-deadline.ts";
import type { RetryResolvable } from "./retry.ts";

/** Request-only controls resolved before request construction. */
export interface RequestStart {
	/** Admission controls the rate-limit queue and budget gate honour. */
	readonly admission: AdmissionWaitContext;
	/** Abort and deadline signals for the whole request. */
	readonly lifecycle: RequestLifecycle;
	/** Per-call options to merge over the client config. */
	readonly requestOptions: Partial<RetryResolvable>;
}

/**
 * Resolve the request-only controls of one call before its request is
 * built: fail at once on an already-aborted caller signal or an elapsed
 * deadline, otherwise start the request lifecycle and split the per-call
 * options from the admission controls.
 *
 * @param options - The caller's per-request options, if any.
 * @returns The resolved controls, or the abort or deadline failure.
 */
export function startRequest(
	options: RequestOptions | undefined,
): Result<RequestStart, OpenCloudError> {
	const callerSignal = options?.signal;
	if (callerSignal?.aborted === true) {
		return { err: requestAbortedError(callerSignal), success: false };
	}

	const lifecycle = requestLifecycle(options?.deadlineMs, callerSignal);
	const deadlineFailure = elapsedDeadlineFailure(lifecycle);
	if (deadlineFailure !== undefined) {
		return { err: deadlineFailure, success: false };
	}

	const { deadlineMs, onAdmissionWait, signal: _signal, ...requestOptions } = options ?? {};
	return {
		data: {
			admission: { deadlineMs, observer: onAdmissionWait, signal: lifecycle.signal },
			lifecycle,
			requestOptions: withCredentialSnapshot(requestOptions),
		},
		success: true,
	};
}
