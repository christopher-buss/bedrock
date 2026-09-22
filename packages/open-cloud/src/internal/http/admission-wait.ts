import type {
	AdmissionWaitEvent,
	AdmissionWaitObserver,
	AdmissionWaitReason,
} from "../../client/types.ts";

/** Request-local controls shared by SDK admission mechanisms. */
export interface AdmissionWaitContext {
	/**
	 * Absolute deadline for the logical request, as Unix epoch milliseconds.
	 */
	readonly deadlineMs?: number | undefined;
	/** Observer for this request's admission waits. */
	readonly observer?: AdmissionWaitObserver | undefined;
	/** Optional caller cancellation signal. */
	readonly signal?: AbortSignal | undefined;
}

interface ObserveAdmissionWaitOptions<T> {
	/** Intended wait duration, when the scheduler can determine one. */
	readonly durationMs?: number;
	/** Request-scoped notification callback. */
	readonly observer?: AdmissionWaitObserver | undefined;
	/** SDK admission mechanism responsible for the wait. */
	readonly reason: AdmissionWaitReason;
	/** The actual wait to perform. */
	readonly waitAsync: () => Promise<T>;
}

/**
 * Performs one SDK-managed wait and emits a balanced request-scoped lifecycle.
 * Observer failures are deliberately ignored: observation cannot become part
 * of admission control.
 *
 * @template T - Value produced by the observed wait.
 * @param options - Wait metadata, observer, and the wait operation itself.
 * @returns The value produced by the wait.
 */
export async function observeAdmissionWaitAsync<T>({
	durationMs,
	observer,
	reason,
	waitAsync,
}: ObserveAdmissionWaitOptions<T>): Promise<T> {
	const details = {
		...(durationMs === undefined ? {} : { durationMs }),
		reason,
	};
	notify(observer, { ...details, phase: "started" });
	try {
		return await waitAsync();
	} finally {
		notify(observer, { ...details, phase: "ended" });
	}
}

function notify(observer: AdmissionWaitObserver | undefined, event: AdmissionWaitEvent): void {
	try {
		const notification = observer?.(event);
		if (notification !== undefined) {
			// `Boolean` consumes every rejection without throwing; the returned
			// promise and its boolean fulfillment are deliberately ignored.
			void Promise.resolve(notification).catch(Boolean);
		}
	} catch {
		// Admission observers are notification-only and cannot alter control
		// flow.
	}
}
