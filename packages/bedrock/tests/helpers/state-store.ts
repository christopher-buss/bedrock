import type { BedrockState, StateError, StateRecord, StateVersion } from "#src/core/state";
import type { StatePort } from "#src/ports/state-port";

/** An in-memory **State** store plus the log of what was done to it. */
export interface FakeStateStore {
	/** The port to build a **Backend** over. */
	readonly port: StatePort;
	/** What the store holds now, keyed by **Environment**. */
	readonly states: ReadonlyMap<string, BedrockState>;
	/** Every write the store was asked for, in call order. */
	readonly writes: ReadonlyArray<RecordedWrite>;
}

/** One write a fake store was asked for, in the order it was asked. */
interface RecordedWrite {
	/** **Environment** the write was for. */
	readonly environment: string;
	/** The record the write was fenced against, if it was fenced. */
	readonly expected: StateVersion | undefined;
}

/** What a fake store holds, and what it refuses. */
interface FakeStateStoreOptions {
	/** **State** the store already holds, keyed by **Environment**. */
	readonly initial?: Readonly<Record<string, BedrockState>>;
	/** Refusals to return from `read`, keyed by **Environment**. */
	readonly refuseRead?: Readonly<Record<string, StateError>>;
	/** Refusals to return from `write`, keyed by **Environment**. */
	readonly refuseWrite?: Readonly<Record<string, StateError>>;
	/**
	 * Log each call appends to, so a test states the order a store was
	 * reached in against whatever else appends to the same log.
	 */
	readonly trace?: Array<string>;
}

/**
 * Build an in-memory **State** store, so a shell test drives real
 * **Backend** dispatch against a store it can assert on.
 *
 * @param options - What the store holds and what it refuses.
 * @returns The port plus the log of what was asked of it.
 */
export function fakeStateStore(options: FakeStateStoreOptions = {}): FakeStateStore {
	const states = new Map(Object.entries(options.initial ?? {}));
	const writes: Array<RecordedWrite> = [];

	const port: StatePort = {
		read: async (environment) => {
			options.trace?.push(`read:${environment}`);
			await Promise.resolve();
			const refusal = options.refuseRead?.[environment];
			if (refusal !== undefined) {
				return { err: refusal, success: false };
			}

			return { data: recordOf(states.get(environment)), success: true };
		},
		write: async (state, expected) => {
			options.trace?.push(`write:${state.environment}`);
			await Promise.resolve();
			writes.push({ environment: state.environment, expected });
			const refusal = options.refuseWrite?.[state.environment];
			if (refusal !== undefined) {
				return { err: refusal, success: false };
			}

			states.set(state.environment, state);
			return { data: undefined, success: true };
		},
	};

	return { port, states, writes };
}

function recordOf(state: BedrockState | undefined): StateRecord {
	return state === undefined
		? { version: { kind: "absent" } }
		: { state, version: { kind: "present", token: `${state.environment}-1` } };
}
