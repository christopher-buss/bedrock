import type { Result } from "@bedrock-rbx/ocale";

import type { Operation } from "../core/operations.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { type AggregateApplyError, applyOps } from "./apply-ops.ts";

/**
 * Inputs for a single {@link applyAndPersist} pass. `priorResources` is the
 * cumulative baseline the pass folds its survivors into before writing, so a
 * later pass receives the previous pass's `merged.resources` here.
 */
export interface ApplyAndPersistInputs {
	/** Environment name threaded into `applyOps` reporting and the snapshot. */
	readonly environment: string;
	/** Subset of reconcile ops applied in this pass, in declaration order. */
	readonly ops: ReadonlyArray<Operation>;
	/** Resources already persisted; survivors merge on top, none are dropped. */
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
	/** Sink for per-resource, summary, and `stateWritten` progress events. */
	readonly progress: ProgressPort;
	/** Per-kind driver table consulted for create / update dispatch. */
	readonly registry: DriverRegistry;
	/** Backend the cumulative snapshot is written to. */
	readonly statePort: StatePort;
}

/**
 * Outcome of a single apply → snapshot → write pass. `merged` is the
 * cumulative snapshot persisted by this pass; a caller threads
 * `merged.resources` into a later pass as the next `priorResources`
 * baseline, and passes the triple to the deploy-level `finalize`.
 */
export interface ReconcilePass {
	/** The `applyOps` outcome: survivors on success, survivors + failures on error. */
	readonly applied: Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>;
	/** Cumulative snapshot built from `priorResources` plus this pass's survivors. */
	readonly merged: BedrockState;
	/** The state-write outcome; carries `merged` as the unsaved snapshot on failure. */
	readonly written: Result<void, StateError>;
}

interface SnapshotInputs {
	readonly applied: Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>;
	readonly environment: string;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
}

/**
 * Apply one subset of reconcile ops, fold the survivors into the prior
 * resources, and persist the cumulative snapshot. Returns the apply
 * outcome, the merged snapshot, and the write outcome so a caller can
 * `finalize` the pass and thread `merged.resources` into a later pass as
 * the new `priorResources` baseline. Emits `stateWritten` after a
 * successful write.
 *
 * Invoking it more than once over disjoint op subsets accumulates one
 * cumulative snapshot across the writes; a single-pass deploy calls it once.
 *
 * @param inputs - The op subset, the prior-resource baseline, and the
 *   registry, state port, and progress port the pass drives.
 * @returns The apply, snapshot, and write outcomes for the pass.
 */
export async function applyAndPersist(inputs: ApplyAndPersistInputs): Promise<ReconcilePass> {
	const { environment, ops, priorResources, progress, registry, statePort } = inputs;
	const applied = await applyOps(ops, registry, { environment, progress });
	const merged = buildSnapshot({ applied, environment, priorResources });

	const written = await statePort.write(merged);
	if (written.success) {
		progress.emit({ environment, kind: "stateWritten" });
	}

	return { applied, merged, written };
}

function mergeResources(
	pre: ReadonlyArray<ResourceCurrentState>,
	applied: ReadonlyArray<ResourceCurrentState>,
): ReadonlyArray<ResourceCurrentState> {
	const byKey = new Map<string, ResourceCurrentState>();
	for (const resource of pre) {
		byKey.set(`${resource.kind}:${resource.key}`, resource);
	}

	for (const resource of applied) {
		byKey.set(`${resource.kind}:${resource.key}`, resource);
	}

	return [...byKey.values()];
}

function buildSnapshot(inputs: SnapshotInputs): BedrockState {
	const appliedResources = inputs.applied.success
		? inputs.applied.data
		: inputs.applied.err.applied;
	return {
		environment: inputs.environment,
		resources: mergeResources(inputs.priorResources, appliedResources),
		version: 1,
	};
}
