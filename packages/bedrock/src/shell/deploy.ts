import type { Result } from "@bedrock/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";

import { diff } from "../core/diff.ts";
import { flattenConfig } from "../core/flatten.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { ResourceKey } from "../types/ids.ts";
import { type ApplyError, applyOps } from "./apply-ops.ts";
import { buildDesired, type BuildDesiredError } from "./build-desired.ts";

/**
 * Inputs for `deploy`. The driven dependencies (`statePort`, `registry`) are
 * passed in so callers control which backends and credentials are used.
 */
export interface DeployOptions {
	/** Pre-loaded, optionally-mutated project config. Use `loadConfig()` to obtain one. */
	readonly config: Config;
	/** Environment name; threaded into `StatePort.read` and the persisted snapshot. */
	readonly environment: string;
	/** Reads file bytes for resources that have file-backed inputs. Defaults to `node:fs/promises.readFile`. */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/** Per-kind driver table consulted for create / update dispatch. */
	readonly registry: DriverRegistry;
	/** Backend used to read the prior snapshot and persist the new one. */
	readonly statePort: StatePort;
}

/**
 * Failure surfaced by `deploy`. Stage-tagged so callers can distinguish
 * a state-read failure from a state-write failure even though both wrap
 * the same `StateError` shape underneath.
 */
export type DeployError =
	| { readonly cause: ApplyError; readonly kind: "applyFailed" }
	| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" }
	| { readonly cause: StateError; readonly kind: "stateReadFailed" }
	| {
			readonly cause: StateError;
			readonly kind: "stateWriteFailed";
			readonly unsavedState: BedrockState;
	  };

interface SnapshotInputs {
	readonly applied: Result<ReadonlyArray<ResourceCurrentState>, ApplyError>;
	readonly environment: string;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
}

interface FinalizeInputs {
	readonly applied: Result<ReadonlyArray<ResourceCurrentState>, ApplyError>;
	readonly merged: BedrockState;
	readonly written: Result<void, StateError>;
}

/**
 * Run a full reconcile end-to-end: build desired state from `config`, read the
 * prior snapshot via `statePort`, diff the two, dispatch operations through the
 * driver `registry`, then persist the merged snapshot back via `statePort`.
 *
 * @param options - Pre-loaded config plus the driven dependencies.
 * @returns The persisted `BedrockState` on success, or a stage-tagged
 *   `DeployError` on failure.
 * @example
 *
 * ```ts
 * import { deploy, type BedrockState, type DriverRegistry, type StatePort } from "bedrock";
 *
 * const store = new Map<string, BedrockState>();
 * const statePort: StatePort = {
 *     async read(environment) {
 *         return { data: store.get(environment), success: true };
 *     },
 *     async write(state) {
 *         store.set(state.environment, state);
 *         return { data: undefined, success: true };
 *     },
 * };
 * const registry: DriverRegistry = {
 *     gamePass: { create: async () => ({ data: undefined as never, success: false, err: undefined as never }) },
 *     place: { create: async () => ({ data: undefined as never, success: false, err: undefined as never }) },
 * };
 *
 * return deploy({
 *     config: { passes: {} },
 *     environment: "production",
 *     registry,
 *     statePort,
 * }).then((result) => {
 *     expect(result.success).toBeTrue();
 *     if (result.success) {
 *         expect(result.data.environment).toBe("production");
 *         expect(result.data.resources).toBeEmpty();
 *     }
 * });
 * ```
 */
export async function deploy(options: DeployOptions): Promise<Result<BedrockState, DeployError>> {
	const readFile = options.readFile ?? nodeReadFile;

	const desired = await buildDesired(flattenConfig(options.config), readFile);
	if (!desired.success) {
		return { err: { cause: desired.err, kind: "buildDesiredFailed" }, success: false };
	}

	const prior = await options.statePort.read(options.environment);
	if (!prior.success) {
		return { err: { cause: prior.err, kind: "stateReadFailed" }, success: false };
	}

	const priorResources = prior.data?.resources ?? [];
	const ops = diff(desired.data, priorResources);
	const applied = await applyOps(ops, options.registry);
	const merged = buildSnapshot({ applied, environment: options.environment, priorResources });

	const written = await options.statePort.write(merged);
	return finalize({ applied, merged, written });
}

function mergeResources(
	pre: ReadonlyArray<ResourceCurrentState>,
	applied: ReadonlyArray<ResourceCurrentState>,
): ReadonlyArray<ResourceCurrentState> {
	const byKey = new Map<ResourceKey, ResourceCurrentState>();
	for (const resource of pre) {
		byKey.set(resource.key, resource);
	}

	for (const resource of applied) {
		byKey.set(resource.key, resource);
	}

	return [...byKey.values()];
}

function buildSnapshot(inputs: SnapshotInputs): BedrockState {
	const appliedResources = inputs.applied.success
		? inputs.applied.data
		: inputs.applied.err.appliedSoFar;
	return {
		environment: inputs.environment,
		resources: mergeResources(inputs.priorResources, appliedResources),
		version: 1,
	};
}

function finalize(inputs: FinalizeInputs): Result<BedrockState, DeployError> {
	if (!inputs.applied.success) {
		return { err: { cause: inputs.applied.err, kind: "applyFailed" }, success: false };
	}

	if (!inputs.written.success) {
		return {
			err: {
				cause: inputs.written.err,
				kind: "stateWriteFailed",
				unsavedState: inputs.merged,
			},
			success: false,
		};
	}

	return { data: inputs.merged, success: true };
}
