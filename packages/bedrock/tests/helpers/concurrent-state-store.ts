import type { BedrockState, StatePort, StateRecord } from "@bedrock-rbx/core";

interface ConcurrentStore {
	readonly port: StatePort;
	readonly state: BedrockState;
}
interface Context {
	readonly original: StateRecord;
	persisted: BedrockState;
	reads: number;
}
interface MutableContext {
	persisted: BedrockState;
	revision: number;
}
interface MutableStore extends ConcurrentStore {
	readonly replace: (state: BedrockState) => void;
}

/**
 * Build a version-enforcing backend with an independent concurrent writer.
 * @param initial - State at revision one.
 * @returns Persistence and an external writer that advances the revision.
 */
export function mutableFencedStateStore(initial: BedrockState): MutableStore {
	const context = { persisted: initial, revision: 1 };
	return {
		port: {
			read: async () => {
				await Promise.resolve();
				return {
					data: {
						state: context.persisted,
						version: { kind: "present", token: String(context.revision) },
					},
					success: true,
				};
			},
			write: async (state, expected) => writeRevisionAsync(context, { expected, state }),
		},
		replace: (state) => {
			replaceState(context, state);
		},
		get state() {
			return context.persisted;
		},
	};
}

/**
 * A version-enforcing backend that changes immediately after the first read.
 * @param original - Record returned by the first read.
 * @param concurrent - Concurrently persisted State, named by v2.
 * @returns The backend and its currently persisted State.
 */
export function concurrentStateStore(
	original: StateRecord,
	concurrent: BedrockState,
): ConcurrentStore {
	const context = { original, persisted: concurrent, reads: 0 };
	const port: StatePort = {
		read: async () => readAsync(context),
		write: async (state, expected) => writeAsync(context, { expected, state }),
	};
	return {
		port,
		get state() {
			return context.persisted;
		},
	};
}

function replaceState(context: MutableContext, state: BedrockState): void {
	context.persisted = state;
	context.revision += 1;
}

async function writeRevisionAsync(
	context: MutableContext,
	{
		expected,
		state,
	}: { readonly expected: Parameters<StatePort["write"]>[1]; readonly state: BedrockState },
): ReturnType<StatePort["write"]> {
	await Promise.resolve();
	if (expected?.kind !== "present" || expected.token !== String(context.revision)) {
		return {
			err: { file: "production", kind: "stateConflict", reason: "record changed" },
			success: false,
		};
	}

	replaceState(context, state);
	return { data: undefined, success: true };
}

async function readAsync(context: Context): ReturnType<StatePort["read"]> {
	await Promise.resolve();
	context.reads += 1;
	return {
		data:
			context.reads === 1
				? context.original
				: { state: context.persisted, version: { kind: "present", token: "v2" } },
		success: true,
	};
}

async function writeAsync(
	context: Context,
	{
		expected,
		state,
	}: { readonly expected: Parameters<StatePort["write"]>[1]; readonly state: BedrockState },
): ReturnType<StatePort["write"]> {
	await Promise.resolve();
	if (expected?.kind !== "present" || expected.token !== "v2") {
		return {
			err: { file: "production", kind: "stateConflict", reason: "record changed" },
			success: false,
		};
	}

	context.persisted = state;
	return { data: undefined, success: true };
}
