import type { BedrockState, StateVersion } from "../core/state.ts";
import type { StatePort } from "../ports/state-port.ts";

/**
 * Wrap a State port so its reads show the run's unsaved imports until the
 * first write, which carries them into the backend.
 *
 * @param statePort - The Environment's State port.
 * @param imported - Saved State with the imports added.
 * @returns A State port that reads `imported` until the first write.
 */
export function withImportedState(statePort: StatePort, imported: BedrockState): StatePort {
	let written = false;
	// A record read as absent names no record that could carry the imports, so
	// this port keeps that fence and applies it to the first write.
	let absentFence: StateVersion | undefined;
	async function readAsync(environment: string): ReturnType<StatePort["read"]> {
		const read = await statePort.read(environment);
		if (written || !read.success) {
			return read;
		}

		const { version } = read.data;
		if (version?.kind === "present") {
			return { data: { state: imported, version }, success: true };
		}

		absentFence = version;
		return { data: { state: imported }, success: true };
	}

	async function writeAsync(
		state: BedrockState,
		expected?: StateVersion,
	): ReturnType<StatePort["write"]> {
		const fence = written ? expected : (expected ?? absentFence);
		written = true;
		return statePort.write(state, fence);
	}

	return { read: readAsync, write: writeAsync };
}
