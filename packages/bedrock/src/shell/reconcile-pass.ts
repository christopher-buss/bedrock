import type { Result } from "@bedrock-rbx/ocale";

import type { Operation } from "../core/operations.ts";
import type { ResourceCurrentState, ResourceRealDisplay } from "../core/resources.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { ResourceKey, Sha256Hex } from "../types/ids.ts";
import { type AggregateApplyError, applyOps } from "./apply-ops.ts";

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

/**
 * Inputs for a single {@link applyAndPersist} pass. `priorResources` is the
 * cumulative baseline the pass folds its survivors into before writing, so a
 * later pass receives the previous pass's `merged.resources` here.
 */
interface ApplyAndPersistInputs {
	/** Optional per-key rebuilt artifact bytes forwarded to `applyOps` as apply context. */
	readonly artifacts?: ReadonlyMap<ResourceKey, Uint8Array>;
	/**
	 * Codegen fingerprint to stamp onto the persisted snapshot. Omit (or pass
	 * `undefined`) to leave the field off; a caller threads the stored hash
	 * through to preserve it, and the freshly emitted hash on the write that
	 * completes a successful rebuild. Stamped only when the pass fully applies:
	 * a partial failure drops the hash so the next deploy re-detects the change.
	 */
	readonly codegenHash?: Sha256Hex | undefined;
	/** Environment name threaded into `applyOps` reporting and the snapshot. */
	readonly environment: string;
	/** Subset of reconcile ops applied in this pass, in declaration order. */
	readonly ops: ReadonlyArray<Operation>;
	/**
	 * Place keys to record as owing a rebuild. Stamped onto the persisted
	 * snapshot when non-empty; an empty or absent set leaves the marker off.
	 */
	readonly pendingRebuild?: ReadonlySet<ResourceKey>;
	/** Resources already persisted; survivors merge on top, none are dropped. */
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
	/** Sink for per-resource, summary, and `stateWritten` progress events. */
	readonly progress: ProgressPort;
	/**
	 * Real (pre-redaction) display values for redacted resources, keyed by the
	 * `kind:key` composite. Stamped onto the persisted snapshot when non-empty;
	 * never read by the apply or diff path. Omit when nothing is redacted.
	 */
	readonly realDisplay?: Readonly<Record<string, ResourceRealDisplay>>;
	/** Per-kind driver table consulted for create / update dispatch. */
	readonly registry: DriverRegistry;
	/** Backend the cumulative snapshot is written to. */
	readonly statePort: StatePort;
}

interface SnapshotInputs {
	readonly applied: Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>;
	readonly codegenHash: Sha256Hex | undefined;
	readonly environment: string;
	readonly pendingRebuild: ReadonlySet<ResourceKey> | undefined;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
	readonly realDisplay: Readonly<Record<string, ResourceRealDisplay>> | undefined;
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
	const {
		artifacts,
		codegenHash,
		environment,
		ops,
		pendingRebuild,
		priorResources,
		progress,
		realDisplay,
		registry,
		statePort,
	} = inputs;
	const applied = await applyOps(ops, registry, { environment, progress }, artifacts);
	const merged = buildSnapshot({
		applied,
		codegenHash,
		environment,
		pendingRebuild,
		priorResources,
		realDisplay,
	});

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
	// Later entries win on key collision; the Map keeps each key at its
	// first-seen position, so prior resources hold their slot and applied
	// survivors override in place, with applied-only keys appended.
	const byKey = new Map(
		[...pre, ...applied].map((resource) => [`${resource.kind}:${resource.key}`, resource]),
	);
	return [...byKey.values()];
}

function scopeRealDisplay(
	realDisplay: Readonly<Record<string, ResourceRealDisplay>> | undefined,
	resources: ReadonlyArray<ResourceCurrentState>,
): Readonly<Record<string, ResourceRealDisplay>> {
	// Drop real-display entries whose resource is not in the persisted snapshot,
	// keeping `realDisplay` aligned with `resources` across adapters: a file
	// adapter co-locates only matching siblings, so an in-memory adapter must
	// not retain orphan keys for resources a partial apply dropped.
	if (realDisplay === undefined) {
		return {};
	}

	const present = new Set(resources.map((resource) => `${resource.kind}:${resource.key}`));
	return Object.fromEntries(Object.entries(realDisplay).filter(([key]) => present.has(key)));
}

function buildSnapshot(inputs: SnapshotInputs): BedrockState {
	const { applied, codegenHash, environment, pendingRebuild, priorResources, realDisplay } =
		inputs;
	const appliedResources = applied.success ? applied.data : applied.err.applied;
	const resources = mergeResources(priorResources, appliedResources);
	const marker =
		pendingRebuild === undefined || pendingRebuild.size === 0 ? {} : { pendingRebuild };
	const scoped = scopeRealDisplay(realDisplay, resources);
	const real = Object.keys(scoped).length === 0 ? {} : { realDisplay: scoped };
	// Advance the fingerprint only when every op in the pass applied: a failed
	// republish must not record that the place was rebuilt against the emitted
	// source, so the hash is dropped and the next deploy re-detects the change.
	const hash = codegenHash === undefined || !applied.success ? {} : { codegenHash };

	return {
		...hash,
		environment,
		...marker,
		...real,
		resources,
		version: 1,
	};
}
