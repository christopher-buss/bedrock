import type { InterruptSignal, SignalSource } from "#src/cli/interrupt-signals";

/** A {@link SignalSource} a test sends signals through. */
export interface FakeSignalSource extends SignalSource {
	/** Counts the listeners still attached. */
	readonly count: () => number;
	/** Calls every listener attached for `signal`. */
	readonly send: (signal: InterruptSignal) => void;
}

/**
 * Build a fake process that records its signal listeners.
 *
 * @returns A signal source a test drives with `send`.
 */
export function fakeSignalSource(): FakeSignalSource {
	const listeners = new Map<InterruptSignal, Set<() => void>>();
	return {
		count: () => listeners.values().reduce((total, set) => total + set.size, 0),
		off: (signal, listener) => listeners.get(signal)?.delete(listener),
		on: (signal, listener) => {
			const set = listeners.get(signal) ?? new Set();
			set.add(listener);
			listeners.set(signal, set);
		},
		send: (signal) => {
			const attached = [...(listeners.get(signal) ?? [])];
			for (const listener of attached) {
				listener();
			}
		},
	};
}
