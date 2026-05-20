import type { Result } from "@bedrock-rbx/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";
import process from "node:process";

import { createDefaultProgressAdapter } from "../adapters/clack-progress-adapter.ts";
import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import { createNoOpProgressAdapter } from "../adapters/no-op-progress-adapter.ts";
import { assertAllReconcilable } from "../core/assert-all-reconcilable.ts";
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
import type { ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { type AggregateApplyError, applyOps } from "./apply-ops.ts";
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
 * and the environment variables `BEDROCK_GITHUB_TOKEN` and `BEDROCK_API_KEY`.
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
	/**
	 * Optional sink for per-resource and aggregate progress events. When
	 * supplied, `applyOps` emits one started/terminal pair per non-noop op
	 * (plus per-noop and summary events), and `deploy` emits `stateWritten`
	 * after a successful state-write. Omit to run silently.
	 */
	readonly progress?: ProgressPort;
	/** Reads file bytes for resources that have file-backed inputs. Defaults to `node:fs/promises.readFile`. */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/** Per-kind driver table consulted for create / update dispatch. Default-constructed from `BEDROCK_API_KEY` when omitted. */
	readonly registry?: DriverRegistry;
	/** Backend used to read the prior snapshot and persist the new one. Default-constructed from `config.state` and `BEDROCK_GITHUB_TOKEN` when omitted. */
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
	| { readonly cause: AggregateApplyError; readonly kind: "applyFailed" }
	| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" }
	| { readonly cause: ConfigError; readonly kind: "configLoadFailed" }
	| { readonly cause: StateError; readonly kind: "stateReadFailed" }
	| {
			readonly cause: StateError;
			readonly kind: "stateWriteFailed";
			readonly unsavedState: BedrockState;
	  };

interface SnapshotInputs {
	readonly applied: Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>;
	readonly environment: string;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
}

interface FinalizeInputs {
	readonly applied: Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>;
	readonly merged: BedrockState;
	readonly written: Result<void, StateError>;
}

interface ResolvedDepsBase {
	readonly config: ResolvedConfig;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly registry: DriverRegistry;
	readonly statePort: StatePort;
}

interface ResolvedDeps extends ResolvedDepsBase {
	readonly progress: ProgressPort;
}

interface PickRegistryInputs {
	readonly config: ResolvedConfig;
	readonly options: DeployOptions;
	readonly readFile: (path: string) => Promise<Uint8Array>;
}

interface EmitTerminalEventInputs {
	readonly environment: string;
	readonly progress: ProgressPort;
	readonly result: Result<BedrockState, DeployError>;
}

/**
 * Decide whether `BEDROCK_CLI` should select the clack-backed default
 * progress adapter. Exported for direct unit coverage of the boundary
 * (`undefined` and empty string both flip to no-op; any non-empty value
 * picks clack).
 *
 * @param value - Raw `BEDROCK_CLI` value as returned by `getEnv`.
 * @returns `true` if the clack adapter should be the default.
 */
export function isCliEnvironmentFlagSet(value: string | undefined): boolean {
	return value !== undefined && value !== "";
}

/**
 * Run a full reconcile end-to-end. Default-constructs missing deps from
 * the project config and the environment variables `BEDROCK_GITHUB_TOKEN`
 * and `BEDROCK_API_KEY`; emits a terminal `deploySuccess` or `deployFailure`
 * event through the resolved `progress` port. When `progress` is omitted,
 * the default port comes from `BEDROCK_CLI`: a non-empty value selects the
 * clack-backed adapter, any other reading selects the no-op adapter. No
 * environment lookups happen when `statePort`, `registry`, `config`, and
 * `progress` are all supplied explicitly.
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
	if (options.progress !== undefined) {
		return runAndEmit(options, options.progress);
	}

	if (!isCliEnvironmentFlagSet(getEnvironmentOf(options)("BEDROCK_CLI"))) {
		return runAndEmit(options, createNoOpProgressAdapter());
	}

	return runWithDeferredClackProgress(options);
}

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}

function getEnvironmentOf(options: DeployOptions): (name: string) => string | undefined {
	return options.getEnv ?? readProcessEnvironment;
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

async function resolveDeps(options: DeployOptions): Promise<Result<ResolvedDepsBase, DeployError>> {
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
		data: { config: effective, readFile, registry: registry.data, statePort: statePort.data },
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
		: inputs.applied.err.applied;
	return {
		environment: inputs.environment,
		resources: mergeResources(inputs.priorResources, appliedResources),
		version: 1,
	};
}

function finalize(inputs: FinalizeInputs): Result<BedrockState, DeployError> {
	// Check write before apply: only the write carries `unsavedState`.
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

	if (!inputs.applied.success) {
		return { err: { cause: inputs.applied.err, kind: "applyFailed" }, success: false };
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
	const validated = assertAllReconcilable(desired.data, priorResources);
	if (!validated.success) {
		return { err: { cause: validated.err, kind: "buildDesiredFailed" }, success: false };
	}

	const ops = diff(desired.data, priorResources);
	const applied = await applyOps(ops, deps.registry, { environment, progress: deps.progress });
	const merged = buildSnapshot({ applied, environment, priorResources });

	const written = await deps.statePort.write(merged);
	if (written.success) {
		deps.progress.emit({ environment, kind: "stateWritten" });
	}

	return finalize({ applied, merged, written });
}

async function runDeploy(
	options: DeployOptions,
	progress: ProgressPort,
): Promise<Result<BedrockState, DeployError>> {
	const resolved = await resolveDeps(options);
	if (!resolved.success) {
		return resolved;
	}

	return runReconcile(options.environment, { ...resolved.data, progress });
}

function emitTerminalEvent(inputs: EmitTerminalEventInputs): void {
	const { environment, progress, result } = inputs;
	if (result.success) {
		progress.emit({
			environment,
			kind: "deploySuccess",
			resourceCount: result.data.resources.length,
		});
		return;
	}

	progress.emit({ environment, error: result.err, kind: "deployFailure" });
}

async function runAndEmit(
	options: DeployOptions,
	progress: ProgressPort,
): Promise<Result<BedrockState, DeployError>> {
	const result = await runDeploy(options, progress);
	emitTerminalEvent({ environment: options.environment, progress, result });
	return result;
}

async function runWithDeferredClackProgress(
	options: DeployOptions,
): Promise<Result<BedrockState, DeployError>> {
	// Defer building the clack adapter until config has resolved so the
	// `stateWritten` label reflects the loaded backend (e.g. `gist:abc`)
	// even when callers omit `options.config` and rely on `loadConfig()`.
	// On early failure, fall back to the caller-supplied `options.config`
	// (which may be undefined), keeping the generic `"state"` placeholder.
	const resolved = await resolveDeps(options);
	const labelConfig = resolved.success ? resolved.data.config : options.config;
	const progress = createDefaultProgressAdapter(labelConfig);

	if (!resolved.success) {
		emitTerminalEvent({ environment: options.environment, progress, result: resolved });
		return resolved;
	}

	const result = await runReconcile(options.environment, { ...resolved.data, progress });
	emitTerminalEvent({ environment: options.environment, progress, result });
	return result;
}
