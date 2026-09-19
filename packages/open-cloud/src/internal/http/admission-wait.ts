import type {
	AdmissionWait,
	AdmissionWaitObserver,
	AdmissionWaitReason,
} from "../../client/types.ts";

/**
 * The two per-request seams every admission-controlling layer needs: who
 * observes the request's waits, and what cancels them.
 */
export interface AdmissionContext {
	/** Optional per-request observer of admission waits. */
	readonly onAdmissionWait?: AdmissionWaitObserver | undefined;
	/** Optional caller cancellation signal. */
	readonly signal?: AbortSignal | undefined;
}

/**
 * One request's wait for one reason. A span reports at most one wait and
 * settles for good when that wait ends, so every reported start is paired with
 * exactly one end however the wait finishes — including when a turn abandoned
 * by cancellation reaches the line after the caller has given up on it.
 */
export class AdmissionWaitSpan {
	readonly #observer: AdmissionWaitObserver | undefined;
	readonly #reason: AdmissionWaitReason;

	#ended = false;
	#started: AdmissionWait | undefined;

	/**
	 * Creates a span that has not yet begun.
	 *
	 * @param observer - The request's observer, if any.
	 * @param reason - Why the request would be waiting.
	 */
	constructor(observer: AdmissionWaitObserver | undefined, reason: AdmissionWaitReason) {
		this.#observer = observer;
		this.#reason = reason;
	}

	/**
	 * Reports the wait's start. Ignored while the wait is already running,
	 * so the request's own sleep and the line holding it report one wait.
	 *
	 * @param waitMs - Intended wait in milliseconds, when known.
	 */
	public begin(waitMs?: number): void {
		if (this.#started !== undefined || this.#ended) {
			return;
		}

		this.#started = {
			phase: "start",
			reason: this.#reason,
			...(waitMs === undefined ? {} : { waitMs }),
		};
		this.#notify(this.#started);
	}

	/** Settles the span, reporting the wait's end if it began. */
	public end(): void {
		const started = this.#started;
		this.#ended = true;
		this.#started = undefined;
		if (started !== undefined) {
			this.#notify({ ...started, phase: "end" });
		}
	}

	#notify(wait: AdmissionWait): void {
		try {
			this.#observer?.(wait);
		} catch {
			// Observers are notification-only: a throwing one cannot alter the
			// request.
		}
	}
}
