import type { Result } from "@bedrock-rbx/ocale";

import { flattenConfig } from "../core/flatten.ts";
import { rebindCurrent } from "../core/rebind-current.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState, StateError, StateRecord } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { DeployError } from "./deploy.ts";
import { type LiveCheck, type LiveCheckOptions, readLiveStateAsync } from "./read-live-state.ts";
import { readVisibilityCheckpointAsync } from "./read-visibility-checkpoint.ts";

interface Inputs extends LiveCheckOptions {
	readonly config: ResolvedConfig;
	readonly environment: string;
	readonly registry: DriverRegistry;
	readonly statePort: StatePort;
}
type Baseline = Pick<BedrockState, "pendingRebuild" | "realDisplay" | "resources"> & {
	readonly record: StateRecord;
};
interface LiveDeploy {
	readonly check: LiveCheck;
	readonly liveResources?: () => ReadonlyArray<ResourceCurrentState> | undefined;
	readonly statePort: StatePort;
}

/**
 * Keep the saved observation and its version together. Live values supply only
 * the first pass's comparison; failed and withheld work retains saved State.
 * After a write attempt, later stages observe the backend or unsaved snapshot.
 * @param inputs - The environment, saved State, and authenticated readers.
 * @returns A check report and State port supplying the live baseline.
 */
export async function prepareLiveDeployAsync(
	inputs: Inputs,
): Promise<Result<LiveDeploy, DeployError>> {
	const baseline = await readBaselineAsync(inputs);
	if (!baseline.success) {
		return baseline;
	}

	const live = await readLiveStateAsync(inputs.registry, {
		...inputs,
		resources: baseline.data.resources,
	});
	if (!live.success) {
		return live;
	}

	return {
		data: {
			check: live.data.check,
			...beforeFirstWrite(inputs, {
				baseline: baseline.data,
				resources: live.data.resources,
			}),
		},
		success: true,
	};
}

function hasReaders(inputs: Inputs): boolean {
	const { badge, developerProduct, gamePass, place, universe } = inputs.registry;
	return (
		inputs.live !== false &&
		[badge, developerProduct, gamePass, place, universe].some(
			(driver) => driver.list !== undefined,
		)
	);
}

async function readBaselineAsync(inputs: Inputs): Promise<Result<Baseline, DeployError>> {
	if (!hasReaders(inputs)) {
		return { data: { record: {}, resources: [] }, success: true };
	}

	const prior = await inputs.statePort.read(inputs.environment);
	if (!prior.success) {
		return { err: { cause: prior.err, kind: "stateReadFailed" }, success: false };
	}

	const rebound = rebindCurrent(flattenConfig(inputs.config), {
		...prior.data.state,
		orphanPolicy: inputs.config.orphans,
		resources: prior.data.state?.resources ?? [],
	});
	return rebound.success
		? { data: { ...rebound.data, record: prior.data }, success: true }
		: { err: { cause: rebound.err, kind: "buildDesiredFailed" }, success: false };
}

function withBaseline(
	read: Result<StateRecord, StateError>,
	baseline: Baseline,
): Result<StateRecord, StateError> {
	if (!read.success || read.data.state === undefined) {
		return read;
	}

	const state = { ...read.data.state, resources: baseline.resources };
	if (baseline.pendingRebuild !== undefined) {
		state.pendingRebuild = baseline.pendingRebuild;
	}

	if (baseline.realDisplay !== undefined) {
		state.realDisplay = baseline.realDisplay;
	}

	return { data: { ...read.data, state }, success: true };
}

async function readCheckpointAsync(
	inputs: Inputs,
	{
		checkpoint,
		environment,
	}: { readonly checkpoint: BedrockState | undefined; readonly environment: string },
): ReturnType<StatePort["read"]> {
	return checkpoint === undefined
		? inputs.statePort.read(environment)
		: readVisibilityCheckpointAsync({
				environment,
				reason: "State changed after the deployment checkpoint",
				state: checkpoint,
				statePort: inputs.statePort,
			});
}

function beforeFirstWrite(
	inputs: Inputs,
	{
		baseline,
		resources,
	}: { readonly baseline: Baseline; readonly resources: ReadonlyArray<ResourceCurrentState> },
): Pick<LiveDeploy, "liveResources" | "statePort"> {
	if (!hasReaders(inputs)) {
		return { statePort: inputs.statePort };
	}

	let writeAttempted = false;
	let checkpoint: BedrockState | undefined;
	async function readAsync(environment: string): ReturnType<StatePort["read"]> {
		const read = await readCheckpointAsync(inputs, { checkpoint, environment });
		return writeAttempted || !read.success
			? read
			: withBaseline({ data: baseline.record, success: true }, baseline);
	}

	async function writeAsync(
		...args: Parameters<StatePort["write"]>
	): ReturnType<StatePort["write"]> {
		writeAttempted = true;
		const written = await inputs.statePort.write(...args);
		// A failed write aborts later stages and carries its unsaved snapshot.
		[checkpoint] = args;

		return written;
	}

	return {
		liveResources: () => (writeAttempted ? undefined : resources),
		statePort: { read: readAsync, write: writeAsync },
	};
}
