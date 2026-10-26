import { OpenCloudError, type Result } from "@bedrock-rbx/ocale";

import { createHash } from "node:crypto";

import { flattenConfig } from "../core/flatten.ts";
import { needsArtifact } from "../core/needs-artifact.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState, StateError, StateRecord, StateVersion } from "../core/state.ts";
import {
	lastConfirmedVisibility,
	matchesVisibilityPreparation,
	withVisibilityJournal,
} from "../core/universe-visibility.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey } from "../types/ids.ts";
import type { ApplyOpsReporting } from "./apply-ops.ts";
import { transitionAsync as sendTransitionAsync } from "./apply-visibility.ts";
import type { DeployError } from "./deploy.ts";
import {
	readVisibilityCheckpointAsync,
	visibilityStateFailure as stateFailure,
} from "./read-visibility-checkpoint.ts";
import { runUnmanagedVisibilityAsync } from "./unmanaged-visibility.ts";

type StageResult = Result<BedrockState, DeployError>;
type Visibility = "private" | "public";
type Journal = BedrockState["universeVisibility"];
type Run = (config: ResolvedConfig, statePort: StatePort) => Promise<StageResult>;

interface Inputs {
	readonly config: ResolvedConfig;
	readonly environment: string;
	readonly registry: DriverRegistry;
	readonly reporting?: ApplyOpsReporting | undefined;
	readonly run: Run;
	readonly stage: "deploy" | "provision" | "publish";
	readonly statePort: StatePort;
}

interface Context {
	checkpoint: BedrockState | undefined;
	confirmed: undefined | Visibility;
	readonly fingerprint: string;
	readonly hasArtifacts: boolean;
	readonly inputs: Inputs;
	journal: Journal;
	readonly prepared: boolean;
	record: StateRecord;
	readonly required: boolean;
	state: BedrockState;
	readonly target: Visibility;
	readonly universeId: string;
}

/**
 * Gate one complete stage on its visibility declaration, under its existing
 * lock.
 *
 * @param inputs - Current resolved configuration, ports, and stage runner.
 * @returns The stage's persisted snapshot or its recoverable failure.
 */
export async function runVisibilityStageAsync(inputs: Inputs): Promise<StageResult> {
	const { universe } = inputs.config;
	if (universe?.visibility === undefined) {
		return runUnmanagedVisibilityAsync(inputs);
	}

	const loaded = await inputs.statePort.read(inputs.environment);
	if (!loaded.success) {
		return { err: { cause: loaded.err, kind: "stateReadFailed" }, success: false };
	}

	const context = createContext(inputs, {
		record: loaded.data,
		target: universe.visibility,
		universeId: universe.universeId,
	});
	const prerequisite = await prepareStageAsync(context);
	if (prerequisite !== undefined) {
		return prerequisite;
	}

	const result = await runResourcesAsync(context);
	if (!result.success) {
		return recoverProjectedFailure(context, result);
	}

	context.state = project(context, result.data);
	return finishStageAsync(context);
}

function createContext(
	inputs: Inputs,
	resolved: { record: StateRecord; target: Visibility; universeId: string },
): Context {
	const state = resolved.record.state ?? {
		environment: inputs.environment,
		resources: [],
		version: 1,
	};
	const journal = state.universeVisibility;
	const current = state.resources.find(
		(resource) => resource.kind === "universe" && resource.universeId === resolved.universeId,
	);
	const confirmed = lastConfirmedVisibility(current, {
		journal,
		universeId: resolved.universeId,
	});

	const fingerprint = createHash("sha256").update(JSON.stringify(inputs.config)).digest("hex");
	return {
		checkpoint: resolved.record.state,
		inputs,
		...resolved,
		confirmed,
		fingerprint,
		hasArtifacts: flattenConfig(inputs.config).some(needsArtifact),
		journal,
		prepared: matchesVisibilityPreparation(journal, { ...resolved, fingerprint }),
		required: confirmed !== resolved.target,
		state,
	};
}

function project(context: Context, snapshot: BedrockState): BedrockState {
	const resources = snapshot.resources.map((resource) => {
		if (resource.kind !== "universe" || resource.universeId !== context.universeId) {
			return resource;
		}

		const { visibility: _visibility, ...clean } = resource;
		return context.confirmed === undefined
			? clean
			: { ...clean, visibility: context.confirmed };
	});
	return withVisibilityJournal({ ...snapshot, resources }, context.journal);
}

async function refreshAsync(context: Context): Promise<Result<void, StateError>> {
	const read = await readVisibilityCheckpointAsync({
		...context.inputs,
		state: context.checkpoint,
	});
	if (!read.success) {
		return { err: read.err, success: false };
	}

	context.record = read.data;
	return { data: undefined, success: true };
}

async function persistAsync(
	context: Context,
	snapshot: BedrockState,
): Promise<Result<void, StateError>> {
	context.state = project(context, snapshot);
	const written = await context.inputs.statePort.write(context.state, context.record.version);
	if (!written.success) {
		return written;
	}

	context.checkpoint = context.state;
	return refreshAsync(context);
}

function journalFor(
	context: Context,
	status: NonNullable<Journal>["status"],
): NonNullable<Journal> {
	return { status, target: context.target, universeId: context.universeId };
}

function transitionFailure(context: Context, cause: OpenCloudError): StageResult {
	return {
		err: {
			cause: {
				applied: [],
				failures: [{ key: asResourceKey("main"), cause, kind: "driverFailure" }],
				visibility: [
					{
						status: context.journal?.status === "deferred" ? "deferred" : "unresolved",
						target: context.target,
						universeId: context.universeId,
					},
				],
			},
			kind: "applyFailed",
		},
		success: false,
	};
}

async function transitionAsync(context: Context): Promise<StageResult | undefined> {
	context.confirmed = undefined;
	context.journal = journalFor(context, "intent");
	const intent = await persistAsync(context, context.state);
	if (!intent.success) {
		return stateFailure(intent.err, context);
	}

	const changed = await sendTransitionAsync(context.inputs.registry, {
		reporting: context.inputs.reporting,
		target: context.target,
		universeId: context.universeId,
	});
	if (!changed.success) {
		return transitionFailure(context, changed.err);
	}

	context.confirmed = context.target;
	context.journal = journalFor(context, "confirmed");
	const saved = await persistAsync(context, context.state);
	return saved.success
		? undefined
		: stateFailure(saved.err, {
				...context,
				unrecorded: context.state.resources.filter((resource) => {
					return (
						resource.kind === "universe" && resource.universeId === context.universeId
					);
				}),
			});
}

async function prepareStageAsync(context: Context): Promise<StageResult | undefined> {
	if (!context.required) {
		return undefined;
	}

	if (context.target === "private") {
		return transitionAsync(context);
	}

	if (context.inputs.stage === "publish") {
		return undefined;
	}

	context.journal = journalFor(context, "deferred");
	const written = await persistAsync(context, context.state);
	return written.success ? undefined : stateFailure(written.err, context);
}

function managedPort(context: Context): StatePort {
	async function readAsync(): Promise<Result<StateRecord, StateError>> {
		const refreshed = await refreshAsync(context);
		return refreshed.success ? { data: context.record, success: true } : refreshed;
	}

	async function writeAsync(
		snapshot: BedrockState,
		expected?: StateVersion,
	): Promise<Result<void, StateError>> {
		context.state = project(context, snapshot);
		const written = await context.inputs.statePort.write(context.state, expected);
		if (!written.success) {
			return written;
		}

		context.checkpoint = context.state;
		return refreshAsync(context);
	}

	return { read: readAsync, write: writeAsync };
}

async function runResourcesAsync(context: Context): Promise<StageResult> {
	const { universe } = context.inputs.config;
	const unmanaged = { ...universe, universeId: context.universeId };
	delete unmanaged.visibility;
	return context.inputs.run(
		{ ...context.inputs.config, universe: unmanaged },
		managedPort(context),
	);
}

function recoverProjectedFailure(context: Context, result: StageResult): StageResult {
	if (result.success || result.err.kind !== "stateWriteFailed") {
		return result;
	}

	return {
		err: { ...result.err, unsavedState: project(context, result.err.unsavedState) },
		success: false,
	};
}

async function refuseActivationAsync(context: Context): Promise<StageResult> {
	context.journal = { status: "deferred", target: "public", universeId: context.universeId };
	const saved = await persistAsync(context, context.state);
	if (!saved.success) {
		return stateFailure(saved.err, context);
	}

	return transitionFailure(
		context,
		new OpenCloudError(
			"Public visibility requires successful provision with the current configuration and all owed places published",
		),
	);
}

async function finalizeVisibilityAsync(context: Context): Promise<StageResult | undefined> {
	if (!context.required || context.target === "private") {
		context.journal = undefined;
		return undefined;
	}

	if (context.inputs.stage === "provision" && context.hasArtifacts) {
		context.journal = {
			preparation: context.fingerprint,
			status: "deferred",
			target: "public",
			universeId: context.universeId,
		};
		return undefined;
	}

	if (
		context.inputs.stage === "publish" &&
		(!context.prepared || (context.state.pendingRebuild?.size ?? 0) > 0)
	) {
		return refuseActivationAsync(context);
	}

	const failed = await transitionAsync(context);
	context.journal = undefined;
	return failed;
}

async function finishStageAsync(context: Context): Promise<StageResult> {
	const refreshed = await refreshAsync(context);
	if (!refreshed.success) {
		return stateFailure(refreshed.err, context);
	}

	const finalized = await finalizeVisibilityAsync(context);
	if (finalized !== undefined) {
		return finalized;
	}

	const saved = await persistAsync(context, context.state);
	return saved.success
		? { data: context.state, success: true }
		: stateFailure(saved.err, context);
}
