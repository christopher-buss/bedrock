import type { Result } from "@bedrock-rbx/ocale";

import { flattenConfig } from "../core/flatten.ts";
import { rebindCurrent } from "../core/rebind-current.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState, StateError, StateRecord } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { DeployError } from "./deploy.ts";
import { type LiveCheck, type LiveCheckOptions, readLiveStateAsync } from "./read-live-state.ts";

interface Inputs extends LiveCheckOptions {
	readonly config: ResolvedConfig;
	readonly environment: string;
	readonly registry: DriverRegistry;
	readonly statePort: StatePort;
}
type Baseline = Pick<BedrockState, "pendingRebuild" | "realDisplay" | "resources">;

/**
 * Read once before any deployment operation and use Live as the first pass's
 * baseline. Once a write is attempted, subsequent stages and failure recovery
 * observe the State backend; a failed write carries its own unsaved snapshot.
 * @param inputs - The environment, saved State, and authenticated readers.
 * @returns A check report and State port supplying the live baseline.
 */
export async function prepareLiveDeployAsync(
	inputs: Inputs,
): Promise<Result<{ readonly check: LiveCheck; readonly statePort: StatePort }, DeployError>> {
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
			statePort: beforeFirstWrite(inputs, {
				...baseline.data,
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
		return { data: { resources: [] }, success: true };
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
		? rebound
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

function beforeFirstWrite(inputs: Inputs, baseline: Baseline): StatePort {
	if (!hasReaders(inputs)) {
		return inputs.statePort;
	}

	let writeAttempted = false;
	async function readAsync(environment: string): ReturnType<StatePort["read"]> {
		const read = await inputs.statePort.read(environment);
		return writeAttempted ? read : withBaseline(read, baseline);
	}

	async function writeAsync(
		...args: Parameters<StatePort["write"]>
	): ReturnType<StatePort["write"]> {
		writeAttempted = true;
		return inputs.statePort.write(...args);
	}

	return { read: readAsync, write: writeAsync };
}
