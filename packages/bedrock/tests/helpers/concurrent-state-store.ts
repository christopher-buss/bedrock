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
