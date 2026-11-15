/**
 * How long an **Interrupt** waits for in-flight requests before it aborts
 * them. A GitHub Actions cancel sends SIGINT, then SIGTERM 7.5 s later, then
 * a forced kill: 5 s leaves 2.5 s for the **State** write and the lock
 * release.
 */
export const INTERRUPT_GRACE_MS = 5000;

const graceEnds = new WeakMap<AbortSignal, AbortSignal>();

/**
 * The two signals one pass reads during an **Interrupt**.
 */
export interface InterruptWatch {
	/** Stops the watch's timer and listeners. */
	readonly dispose: () => void;
	/** Aborts when the grace period ends; drivers pass it to requests. */
	readonly requests: AbortSignal;
	/** Aborts at the **Interrupt**; no new Operation starts after it. */
	readonly stop: AbortSignal;
}

/**
 * Let a later abort of `graceEnd` end the grace period of an **Interrupt**
 * that `signal` starts, before its time runs out.
 *
 * @param signal - The signal a caller passes to the run.
 * @param graceEnd - Aborts to end the grace period at once.
 */
export function linkGraceEnd(signal: AbortSignal, graceEnd: AbortSignal): void {
	graceEnds.set(signal, graceEnd);
}

/**
 * Watch `signal` for an **Interrupt**. When it aborts, the returned
 * `requests` signal aborts after {@link INTERRUPT_GRACE_MS}, or at once when
 * the grace end linked to `signal` aborts.
 *
 * @param signal - Aborts to start the **Interrupt**.
 * @returns The stop and request signals, and a disposer.
 */
export function watchInterrupt(signal: AbortSignal): InterruptWatch {
	const requests = new AbortController();
	const graceEnd = graceEnds.get(signal);
	let timer: ReturnType<typeof setTimeout> | undefined;
	function endGrace(): void {
		requests.abort(signal.reason);
	}

	function beginGrace(): void {
		timer = setTimeout(endGrace, INTERRUPT_GRACE_MS);
		if (graceEnd?.aborted === true) {
			endGrace();
		}

		graceEnd?.addEventListener("abort", endGrace);
	}

	if (signal.aborted) {
		beginGrace();
	} else {
		signal.addEventListener("abort", beginGrace);
	}

	return {
		dispose: () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", beginGrace);
			graceEnd?.removeEventListener("abort", endGrace);
		},
		requests: requests.signal,
		stop: signal,
	};
}
