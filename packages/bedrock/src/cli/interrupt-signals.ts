import { linkGraceEnd } from "../shell/interrupt.ts";
import { EXIT_SIGINT, EXIT_SIGTERM } from "./exit-codes.ts";

/** A process signal that starts an **Interrupt**. */
export type InterruptSignal = "SIGINT" | "SIGTERM";

/**
 * Where the CLI listens for process signals. `node:process` fits it.
 */
export interface SignalSource {
	/** Stop calling `listener` on `signal`. */
	readonly off: (signal: InterruptSignal, listener: () => void) => unknown;
	/** Call `listener` on each `signal`. */
	readonly on: (signal: InterruptSignal, listener: () => void) => unknown;
}

/** The **Interrupt** state of one CLI run. */
export interface InterruptListener {
	/** Stops listening for process signals. */
	readonly dispose: () => void;
	/**
	 * The exit code the run owes after an **Interrupt**: 130 after SIGINT,
	 * 143 after SIGTERM. `undefined` when no signal came.
	 */
	readonly exitCode: () => number | undefined;
	/** Aborts on the first signal; passed to the reconcile pipeline. */
	readonly signal: AbortSignal;
}

const EXIT_CODES: Readonly<Record<InterruptSignal, number>> = {
	SIGINT: EXIT_SIGINT,
	SIGTERM: EXIT_SIGTERM,
};

const SIGNALS: ReadonlyArray<InterruptSignal> = ["SIGINT", "SIGTERM"];

/**
 * Listen for SIGINT and SIGTERM for the length of one CLI run. The first
 * signal aborts `signal`, which starts the **Interrupt**. The second ends its
 * grace period at once. No signal exits the process, so the **State** write
 * always runs; only a forced kill stops it.
 *
 * @param source - The process to listen on.
 * @returns The signal, the exit code owed, and a disposer.
 */
export function listenForInterrupt(source: SignalSource): InterruptListener {
	const interrupt = new AbortController();
	const graceEnd = new AbortController();
	linkGraceEnd(interrupt.signal, graceEnd.signal);
	let received: InterruptSignal | undefined;
	const listeners = SIGNALS.map((name) => {
		function listener(): void {
			if (received === undefined) {
				received = name;
				interrupt.abort(new Error(`received ${name}`));
				return;
			}

			graceEnd.abort();
		}

		source.on(name, listener);
		return [name, listener] as const;
	});

	return {
		dispose: () => {
			for (const [name, listener] of listeners) {
				source.off(name, listener);
			}
		},
		exitCode: () => (received === undefined ? undefined : EXIT_CODES[received]),
		signal: interrupt.signal,
	};
}
