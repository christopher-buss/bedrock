import type { Result } from "@bedrock-rbx/ocale";

import { isDeepStrictEqual } from "node:util";

import { flattenConfig } from "../core/flatten.ts";
import { rebindCurrent } from "../core/rebind-current.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import { serializeStateFile } from "../core/state-file.ts";
import type { BedrockState, StateError, StateRecord } from "../core/state.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { DeployError } from "./deploy.ts";

/**
 * Validate full declaration identities before visibility can write.
 * @param inputs - Resolved declarations and the held environment's State port.
 * @returns The baseline, or a read or declaration preflight failure.
 */
export async function readVisibilityBaselineAsync({
	config,
	environment,
	statePort,
}: {
	config: ResolvedConfig;
	environment: string;
	statePort: StatePort;
}): Promise<Result<StateRecord, DeployError>> {
	const loaded = await statePort.read(environment);
	if (!loaded.success) {
		return { err: { cause: loaded.err, kind: "stateReadFailed" }, success: false };
	}

	const preflight = rebindCurrent(flattenConfig(config), loaded.data.state ?? { resources: [] });
	return preflight.success
		? loaded
		: { err: { cause: preflight.err, kind: "buildDesiredFailed" }, success: false };
}

/**
 * Recover a checkpoint's version only while its persisted snapshot still agrees.
 * @param inputs - The expected checkpoint and its persistence port.
 * @returns The matching record, or a read failure or concurrent-change conflict.
 */
export async function readVisibilityCheckpointAsync({
	environment,
	state,
	statePort,
}: {
	environment: string;
	state: BedrockState | undefined;
	statePort: StatePort;
}): Promise<Result<StateRecord, StateError>> {
	const read = await statePort.read(environment);
	if (!read.success) {
		return read;
	}

	if (!isDeepStrictEqual(wireState(read.data.state), wireState(state))) {
		return {
			err: {
				file: environment,
				kind: "stateConflict",
				reason: "State changed after the visibility checkpoint",
			},
			success: false,
		};
	}

	return read;
}

/**
 * Preserve confirmed work when its checkpoint cannot be safely completed.
 * @param cause - The persistence failure.
 * @param snapshot - Confirmed State and changes absent from earlier checkpoints.
 * @returns The existing recoverable State-write error contract.
 */
export function visibilityStateFailure(
	cause: StateError,
	{
		state,
		unrecorded = [],
	}: { state: BedrockState; unrecorded?: ReadonlyArray<ResourceCurrentState> },
): Result<BedrockState, DeployError> {
	return {
		err: { cause, kind: "stateWriteFailed", unrecorded, unsavedState: state },
		success: false,
	};
}

function wireState(state: BedrockState | undefined): JSONValue | undefined {
	return state === undefined ? undefined : JSON.parse(serializeStateFile(state));
}
