import type { Result } from "@bedrock-rbx/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";
import process from "node:process";

import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { ConfigError } from "../core/config-error.ts";
import { diff } from "../core/diff.ts";
import { flattenConfig } from "../core/flatten.ts";
import { resolveStateConfig, type StateNotConfiguredError } from "../core/resolve-state-config.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { Config, ResolvedConfig } from "../core/schema.ts";
import {
	type IncompletePassEntryError,
	type IncompletePlaceEntryError,
	type IncompleteUniverseEntryError,
	selectEnvironment,
	type UnknownEnvironmentError,
} from "../core/select-environment.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import { validatePlan } from "../core/validate-plan.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { type ApplyError, applyOps } from "./apply-ops.ts";
import { buildDefaultRegistry, type RegistryConfigError } from "./build-default-registry.ts";
import { buildDesired, type BuildDesiredError } from "./build-desired.ts";
import {
	buildStatePort,
	type MissingCredentialError,
	type UnsupportedBackendError,
} from "./build-state-port.ts";
import { loadConfig as defaultLoadConfig, type LoadConfigOptions } from "./load-config.ts";

/**
 * Inputs for `deploy`. Every field except `environment` is optional;
 * omitted dependencies are default-constructed from the project config
 * and the environment variables `GITHUB_TOKEN` and `BEDROCK_API_KEY`.
 */
export interface DeployOptions {
	/** Pre-loaded, optionally-mutated project config. Omit to call `loadConfig()` automatically. */
	readonly config?: Config;
	/** Environment name; threaded into `StatePort.read` and the persisted snapshot. */
	readonly environment: string;
	/** `fetch` override plumbed into the default-constructed gist adapter when `statePort` is omitted. */
	readonly fetch?: GistFetch;
	/** Reads an environment variable; defaults to `(name) => process.env[name]`. */
	readonly getEnv?: (name: string) => string | undefined;
	/** Loader invoked when `config` is omitted; defaults to `loadConfig` from this package. */
	readonly loadConfig?: (options?: LoadConfigOptions) => Promise<Result<Config, ConfigError>>;
	/** Reads file bytes for resources that have file-backed inputs. Defaults to `node:fs/promises.readFile`. */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/** Per-kind driver table consulted for create / update dispatch. Default-constructed from `BEDROCK_API_KEY` when omitted. */
	readonly registry?: DriverRegistry;
	/** Backend used to read the prior snapshot and persist the new one. Default-constructed from `config.state` and `GITHUB_TOKEN` when omitted. */
	readonly statePort?: StatePort;
}

/**
 * Failure surfaced by `deploy`. Stage-tagged so callers can branch on
 * `kind` to distinguish reconciliation failures (`stateReadFailed`,
 * `applyFailed`, ...) from default-construction failures
 * (`configLoadFailed`, `stateNotConfigured`, `unknownEnvironment`,
 * `incompletePlaceEntry`, `incompleteUniverseEntry`, `missingCredential`,
 * `unsupportedBackend`, `registryConfigMissing`).
 */
export type DeployError =
	| IncompletePassEntryError
	| IncompletePlaceEntryError
	| IncompleteUniverseEntryError
	| MissingCredentialError
	| RegistryConfigError
	| StateNotConfiguredError
	| UnknownEnvironmentError
	| UnsupportedBackendError
	| { readonly cause: ApplyError; readonly kind: "applyFailed" }
	| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" }
	| { readonly cause: ConfigError; readonly kind: "configLoadFailed" }
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

interface ResolvedDeps {
	readonly config: ResolvedConfig;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly registry: DriverRegistry;
	readonly statePort: StatePort;
}

interface PickRegistryInputs {
	readonly config: ResolvedConfig;
	readonly options: DeployOptions;
	readonly readFile: (path: string) => Promise<Uint8Array>;
}

/**
 * Run a full reconcile end-to-end. Default-constructs missing deps from
 * the project config and the environment variables `GITHUB_TOKEN` and
 * `BEDROCK_API_KEY`; never reads `process.env` when `statePort`,
 * `registry`, and `config` are all supplied explicitly.
 *
 * @param options - Target environment plus optional overrides.
 * @returns The persisted `BedrockState` on success, or a stage-tagged
 *   `DeployError` on failure.
 * @example
 *
 * ```ts
 * import { deploy } from "@bedrock-rbx/core";
 *
 * return deploy({ environment: "production" }).then((result) => {
 *     expect(result.success).toBeFalse();
 *     if (!result.success) {
 *         expect(["configLoadFailed", "stateNotConfigured"]).toContain(result.err.kind);
 *     }
 * });
 * ```
 *
 * @example
 *
 * ```ts
 * import { deploy, type BedrockState, type DriverRegistry, type StatePort } from "@bedrock-rbx/core";
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
 *     developerProduct: {
 *         create: async () => { throw new Error("unreachable: empty config"); },
 *     },
 *     gamePass: { create: async () => { throw new Error("unreachable: empty config"); } },
 *     place: { create: async () => { throw new Error("unreachable: empty config"); } },
 *     universe: { create: async () => { throw new Error("unreachable: empty config"); } },
 * };
 *
 * return deploy({
 *     config: {
 *         environments: { production: {} },
 *         state: { backend: "gist", gistId: "abc" },
 *         passes: {},
 *     },
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
	const resolved = await resolveDeps(options);
	if (!resolved.success) {
		return resolved;
	}

	return runReconcile(options.environment, resolved.data);
}

async function pickConfig(options: DeployOptions): Promise<Result<Config, DeployError>> {
	if (options.config !== undefined) {
		return { data: options.config, success: true };
	}

	const loader = options.loadConfig ?? defaultLoadConfig;
	const loaded = await loader();
	if (!loaded.success) {
		return { err: { cause: loaded.err, kind: "configLoadFailed" }, success: false };
	}

	return { data: loaded.data, success: true };
}

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}

function getEnvironmentOf(options: DeployOptions): (name: string) => string | undefined {
	return options.getEnv ?? readProcessEnvironment;
}

function pickStatePort(
	options: DeployOptions,
	config: ResolvedConfig,
): Result<StatePort, DeployError> {
	if (options.statePort !== undefined) {
		return { data: options.statePort, success: true };
	}

	const stateConfig = resolveStateConfig(config, options.environment);
	if (!stateConfig.success) {
		return { err: stateConfig.err, success: false };
	}

	return buildStatePort({
		fetch: options.fetch,
		getEnv: getEnvironmentOf(options),
		stateConfig: stateConfig.data,
	});
}

function pickRegistry(inputs: PickRegistryInputs): Result<DriverRegistry, DeployError> {
	if (inputs.options.registry !== undefined) {
		return { data: inputs.options.registry, success: true };
	}

	return buildDefaultRegistry({
		config: inputs.config,
		getEnv: getEnvironmentOf(inputs.options),
		readFile: inputs.readFile,
	});
}

async function resolveDeps(options: DeployOptions): Promise<Result<ResolvedDeps, DeployError>> {
	const config = await pickConfig(options);
	if (!config.success) {
		return config;
	}

	const selected = selectEnvironment(config.data, options.environment);
	if (!selected.success) {
		return { err: selected.err, success: false };
	}

	const effective = selected.data;
	const readFile = options.readFile ?? nodeReadFile;

	const statePort = pickStatePort(options, effective);
	if (!statePort.success) {
		return statePort;
	}

	const registry = pickRegistry({ config: effective, options, readFile });
	if (!registry.success) {
		return registry;
	}

	return {
		data: {
			config: effective,
			readFile,
			registry: registry.data,
			statePort: statePort.data,
		},
		success: true,
	};
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

async function runReconcile(
	environment: string,
	deps: ResolvedDeps,
): Promise<Result<BedrockState, DeployError>> {
	const desired = await buildDesired(flattenConfig(deps.config), deps.readFile);
	if (!desired.success) {
		return { err: { cause: desired.err, kind: "buildDesiredFailed" }, success: false };
	}

	const prior = await deps.statePort.read(environment);
	if (!prior.success) {
		return { err: { cause: prior.err, kind: "stateReadFailed" }, success: false };
	}

	const priorResources = prior.data?.resources ?? [];
	const validated = validatePlan(desired.data, priorResources);
	if (!validated.success) {
		return { err: { cause: validated.err, kind: "buildDesiredFailed" }, success: false };
	}

	const ops = diff(desired.data, priorResources);
	const applied = await applyOps(ops, deps.registry);
	const merged = buildSnapshot({ applied, environment, priorResources });

	const written = await deps.statePort.write(merged);
	return finalize({ applied, merged, written });
}
