/* eslint-disable max-lines -- deploy orchestration shell; the reconcile pipeline and its dependency resolution are one cohesive module. */
import type { Result } from "@bedrock-rbx/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";
import process from "node:process";

import { createDefaultProgressAdapter } from "../adapters/clack-progress-adapter.ts";
import { createFsCodegenWriter } from "../adapters/fs-codegen-writer.ts";
import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import { createNoOpProgressAdapter } from "../adapters/no-op-progress-adapter.ts";
import { assertAllReconcilable } from "../core/assert-all-reconcilable.ts";
import { type Emitter, isCodegenEnabled } from "../core/codegen.ts";
import type { ConfigError } from "../core/config-error.ts";
import { createDefaultEmitter, resolveCodegenOutputDirectory } from "../core/default-emitter.ts";
import { diff } from "../core/diff.ts";
import { safeStringify } from "../core/error-chain.ts";
import { flattenConfig } from "../core/flatten.ts";
import type { Operation } from "../core/operations.ts";
import { resolveStateConfig, type StateNotConfiguredError } from "../core/resolve-state-config.ts";
import type {
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
	ResourceRealDisplay,
} from "../core/resources.ts";
import type { Config, ResolvedConfig } from "../core/schema.ts";
import {
	type IncompletePassEntryError,
	type IncompletePlaceEntryError,
	type IncompleteProductEntryError,
	type IncompleteUniverseEntryError,
	resolveEnvironment,
	type UnknownEnvironmentError,
} from "../core/select-environment.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { ResourceKey, Sha256Hex } from "../types/ids.ts";
import type { AggregateApplyError } from "./apply-ops.ts";
import { buildDefaultRegistry, type RegistryConfigError } from "./build-default-registry.ts";
import { buildDesired, type BuildDesiredError } from "./build-desired.ts";
import {
	buildStatePort,
	type MissingCredentialError,
	type PluginStateBackendError,
	type UnsupportedBackendError,
} from "./build-state-port.ts";
import { loadConfig as defaultLoadConfig, type LoadConfigOptions } from "./load-config.ts";
import { applyAndPersistAsync, type ReconcilePass } from "./reconcile-pass.ts";
import { type CodegenError, runCodegenAsync } from "./run-codegen.ts";

/**
 * Build step a fused deploy invokes between its provision and publish stages,
 * once per target environment. It runs after codegen rewrites source and must
 * (re)write each declared place's artifact at its configured `filePath`; the
 * publish stage then uploads from disk, skipping any place whose file hash
 * already matches state. Supplied programmatically because a function cannot
 * round-trip through a config file; the CLI supplies one that spawns the
 * project's `.bedrock/build.ts` override. A throw aborts the deploy with a
 * `buildFailed` error, leaving the checkpoint marker in place for the next run.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { BuildStep } from "@bedrock-rbx/core";
 *
 * const built: Array<string> = [];
 * const build: BuildStep = ({ environment }) => {
 *     built.push(`build places/start.rbxl for ${environment}`);
 * };
 *
 * return Promise.resolve(build({ environment: "production" })).then(() => {
 *     expect(built).toStrictEqual(["build places/start.rbxl for production"]);
 * });
 * ```
 */
export type BuildStep = (input: { readonly environment: string }) => Promise<void> | void;

/**
 * Inputs for `deploy`. Every field except `environment` is optional;
 * omitted dependencies are default-constructed from the project config
 * and the environment variables `BEDROCK_GITHUB_TOKEN` and `BEDROCK_API_KEY`.
 *
 * @since 0.1.0
 */
export interface DeployOptions {
	/**
	 * Build step run between the provision and publish stages of a fused
	 * deploy; see {@link BuildStep}. Required when codegen is enabled and a
	 * place is declared (a codegen project owes a freshly built artifact on
	 * every deploy, so its absence is a `missingBuildStep` error); ignored
	 * when codegen is not enabled, because a no-codegen deploy publishes the
	 * pre-built file in a single pass without building anything.
	 */
	readonly build?: BuildStep;
	/**
	 * Writer for codegen output; defaults to a node-fs writer rooted at
	 * `config.codegen.output`. Supplied to fake the write step at this seam.
	 * Only consulted when codegen is enabled and `emit` is supplied.
	 */
	readonly codegenWriter?: CodegenWriterPort;
	/**
	 * Pre-loaded, optionally-mutated project config. Omit to call
	 * `loadConfig()` automatically.
	 */
	readonly config?: Config;
	/**
	 * Codegen emitter. Supplied programmatically (a function cannot round-trip
	 * through a config file). When codegen is enabled in config and this is
	 * supplied, `deploy` runs it after a successful state write.
	 */
	readonly emit?: Emitter;
	/**
	 * Environment name; threaded into `StatePort.read` and the persisted
	 * snapshot.
	 */
	readonly environment: string;
	/**
	 * `fetch` override plumbed into the default-constructed gist adapter when
	 * `statePort` is omitted.
	 */
	readonly fetch?: GistFetch;
	/**
	 * Reads an environment variable; defaults to `(name) =>
	 * process.env[name]`.
	 */
	readonly getEnv?: (name: string) => string | undefined;
	/**
	 * Loader invoked when `config` is omitted; defaults to `loadConfig` from
	 * this package.
	 */
	readonly loadConfig?: (options?: LoadConfigOptions) => Promise<Result<Config, ConfigError>>;
	/**
	 * Optional sink for per-resource and aggregate progress events. When
	 * supplied, `applyOps` emits one started/terminal pair per non-noop op
	 * (plus per-noop and summary events), and `deploy` emits `stateWritten`
	 * after a successful state-write. Omit to run silently.
	 */
	readonly progress?: ProgressPort;
	/**
	 * Reads file bytes for resources that have file-backed inputs. Defaults to
	 * `node:fs/promises.readFile`.
	 */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/**
	 * Per-kind driver table consulted for create / update dispatch.
	 * Default-constructed from `BEDROCK_API_KEY` when omitted.
	 */
	readonly registry?: DriverRegistry;
	/**
	 * Backend used to read the prior snapshot and persist the new one.
	 * Default-constructed from `config.state` and `BEDROCK_GITHUB_TOKEN` when
	 * omitted.
	 */
	readonly statePort?: StatePort;
}

/**
 * Inputs for `provision`, the asset stage of a decomposed deploy. Mirrors the
 * relevant slice of {@link DeployOptions} minus the place-stage seam: there is
 * no `build` (provision neither builds nor publishes a place). The codegen
 * `emit`/`codegenWriter` seams remain because provision runs the emitter.
 *
 * @since 0.1.0
 */
export interface ProvisionOptions {
	/**
	 * Writer for codegen output; defaults to a node-fs writer rooted at
	 * `config.codegen.output`. Only consulted when codegen is enabled.
	 */
	readonly codegenWriter?: CodegenWriterPort;
	/**
	 * Pre-loaded, optionally-mutated project config. Omit to call
	 * `loadConfig()` automatically.
	 */
	readonly config?: Config;
	/**
	 * Codegen emitter. Supplied programmatically. When codegen is enabled in
	 * config, `provision` runs it after the checkpoint write.
	 */
	readonly emit?: Emitter;
	/**
	 * Environment name; threaded into `StatePort.read` and the persisted
	 * snapshot.
	 */
	readonly environment: string;
	/**
	 * `fetch` override plumbed into the default-constructed gist adapter when
	 * `statePort` is omitted.
	 */
	readonly fetch?: GistFetch;
	/**
	 * Reads an environment variable; defaults to `(name) =>
	 * process.env[name]`.
	 */
	readonly getEnv?: (name: string) => string | undefined;
	/**
	 * Loader invoked when `config` is omitted; defaults to `loadConfig` from
	 * this package.
	 */
	readonly loadConfig?: (options?: LoadConfigOptions) => Promise<Result<Config, ConfigError>>;
	/**
	 * Optional sink for per-resource and aggregate progress events. Omit to
	 * run silently.
	 */
	readonly progress?: ProgressPort;
	/**
	 * Reads file bytes for resources that have file-backed inputs. Defaults to
	 * `node:fs/promises.readFile`.
	 */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/**
	 * Per-kind driver table consulted for create / update dispatch.
	 * Default-constructed from `BEDROCK_API_KEY` when omitted.
	 */
	readonly registry?: DriverRegistry;
	/**
	 * Backend used to read the prior snapshot and persist the new one.
	 * Default-constructed from `config.state` and `BEDROCK_GITHUB_TOKEN` when
	 * omitted.
	 */
	readonly statePort?: StatePort;
}

/**
 * Inputs for `publish`, the place-uploader half of a decomposed deploy. A pure
 * uploader: it mints nothing, runs no codegen, and builds no place, so it omits
 * every asset- and codegen-related seam of {@link DeployOptions}.
 *
 * @since 0.1.0
 */
export interface PublishOptions {
	/**
	 * Pre-loaded, optionally-mutated project config. Omit to call
	 * `loadConfig()` automatically.
	 */
	readonly config?: Config;
	/**
	 * Environment name; threaded into `StatePort.read` and the persisted
	 * snapshot.
	 */
	readonly environment: string;
	/**
	 * `fetch` override plumbed into the default-constructed gist adapter when
	 * `statePort` is omitted.
	 */
	readonly fetch?: GistFetch;
	/**
	 * Reads an environment variable; defaults to `(name) =>
	 * process.env[name]`.
	 */
	readonly getEnv?: (name: string) => string | undefined;
	/**
	 * Loader invoked when `config` is omitted; defaults to `loadConfig` from
	 * this package.
	 */
	readonly loadConfig?: (options?: LoadConfigOptions) => Promise<Result<Config, ConfigError>>;
	/**
	 * Optional sink for per-resource and aggregate progress events. Omit to
	 * run silently.
	 */
	readonly progress?: ProgressPort;
	/**
	 * Reads on-disk place artifacts to publish. Defaults to
	 * `node:fs/promises.readFile`.
	 */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/**
	 * Per-kind driver table consulted for create / update dispatch.
	 * Default-constructed from `BEDROCK_API_KEY` when omitted.
	 */
	readonly registry?: DriverRegistry;
	/**
	 * Backend used to read the prior snapshot and persist the new one.
	 * Default-constructed from `config.state` and `BEDROCK_GITHUB_TOKEN` when
	 * omitted.
	 */
	readonly statePort?: StatePort;
}

/**
 * Failure surfaced by `deploy`. Stage-tagged so callers can branch on
 * `kind` to distinguish reconciliation failures (`stateReadFailed`,
 * `applyFailed`, `codegenFailed`, `buildFailed`, ...) from
 * default-construction failures (`configLoadFailed`, `stateNotConfigured`,
 * `unknownEnvironment`, `incompletePlaceEntry`, `incompleteUniverseEntry`,
 * `missingCredential`, `unsupportedBackend`, `registryConfigMissing`,
 * `missingBuildStep`).
 * `codegenFailed` cannot mask an `applyFailed`: a partial apply still emits
 * codegen for the keys that resolved, but the returned error stays
 * `applyFailed`. A fused deploy whose provision stage fails never runs the
 * build step; a build step that throws returns `buildFailed` with the
 * checkpoint's outputs and marker still persisted, so the next green run
 * self-heals; codegen enabled with no build step available returns
 * `missingBuildStep` before anything is minted.
 *
 * @since 0.1.0
 */
export type DeployError =
	| IncompletePassEntryError
	| IncompletePlaceEntryError
	| IncompleteProductEntryError
	| IncompleteUniverseEntryError
	| MissingCredentialError
	| PluginStateBackendError
	| RegistryConfigError
	| StateNotConfiguredError
	| UnknownEnvironmentError
	| UnsupportedBackendError
	| { readonly cause: AggregateApplyError; readonly kind: "applyFailed" }
	| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" }
	| { readonly cause: CodegenError; readonly kind: "codegenFailed" }
	| { readonly cause: ConfigError; readonly kind: "configLoadFailed" }
	| { readonly cause: StateError; readonly kind: "stateReadFailed" }
	| {
			readonly cause: StateError;
			readonly kind: "stateWriteFailed";
			readonly unsavedState: BedrockState;
	  }
	| { readonly kind: "buildFailed"; readonly reason: string }
	| { readonly kind: "missingBuildStep" };

/** Resolved codegen dependencies; present only when codegen is active. */
interface CodegenBundle {
	readonly emit: Emitter;
	readonly writer: CodegenWriterPort;
}

interface ResolvedDependenciesBase {
	readonly build: BuildStep | undefined;
	readonly codegen: CodegenBundle | undefined;
	readonly config: ResolvedConfig;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly realDisplay: Readonly<Record<string, ResourceRealDisplay>>;
	readonly registry: DriverRegistry;
	readonly statePort: StatePort;
}

interface ResolvedDependencies extends ResolvedDependenciesBase {
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
 * A reconcile pipeline over resolved deps for one environment. `deploy`,
 * `provision`, and `publish` each supply one, sharing the dep-resolution and
 * progress-emission scaffolding around it.
 */
type ReconcileRunner = (
	environment: string,
	deps: ResolvedDependencies,
) => Promise<Result<BedrockState, DeployError>>;

interface RunContext {
	readonly options: DeployOptions;
	readonly progress: ProgressPort;
	readonly runner: ReconcileRunner;
}

interface SettledPassInputs {
	readonly deps: ResolvedDependencies;
	readonly environment: string;
	readonly ops: ReadonlyArray<Operation>;
	readonly owedRebuild: ReadonlySet<ResourceKey>;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
	readonly storedHash: Sha256Hex | undefined;
}

interface SettleOwedInputs {
	readonly ops: ReadonlyArray<Operation>;
	readonly owed: ReadonlySet<ResourceKey>;
	readonly survivors: ReadonlyArray<ResourceCurrentState>;
}

/**
 * Outcome of the provision stage (asset stage + codegen + checkpoint).
 * `outcome` is the caller-facing result: non-success aborts any following
 * build or publish stage.
 */
interface ProvisionStage {
	readonly assetPass: ReconcilePass;
	readonly codegen: Result<Sha256Hex, CodegenError> | undefined;
	readonly outcome: Result<BedrockState, DeployError>;
}

interface AssetStageInputs {
	readonly deps: ResolvedDependencies;
	readonly environment: string;
	readonly markPlaces: ReadonlyArray<ResourceKey>;
	readonly ops: ReadonlyArray<Operation>;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
	readonly storedHash: Sha256Hex | undefined;
}

/**
 * Driven dependencies picked from environment and config once the effective
 * config resolves.
 */
interface DrivenDependencies {
	readonly codegen: CodegenBundle | undefined;
	readonly registry: DriverRegistry;
	readonly statePort: StatePort;
}

interface ReconcileInputs {
	readonly ops: ReadonlyArray<Operation>;
	readonly owedRebuild: ReadonlySet<ResourceKey>;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
	readonly storedHash: Sha256Hex | undefined;
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
 * Run a full reconcile end-to-end. For a codegen project this is the fused
 * composition of {@link provision}, the {@link BuildStep}, and
 * {@link publish} in one invocation: assets are minted and codegen runs, the
 * build step produces each place's artifact once, and the publish stage
 * uploads from disk, skipping any place whose file hash already matches
 * state. Without codegen the deploy publishes the pre-built place files in a
 * single pass. Default-constructs missing deps from the project config and
 * the environment variables `BEDROCK_GITHUB_TOKEN` and `BEDROCK_API_KEY`;
 * emits a terminal `deploySuccess` or `deployFailure` event through the
 * resolved `progress` port. When `progress` is omitted, the default port
 * comes from `BEDROCK_CLI`: a non-empty value selects the clack-backed
 * adapter, any other reading selects the no-op adapter. No environment
 * lookups happen when `statePort`, `registry`, `config`, and `progress` are
 * all supplied explicitly.
 *
 * @since 0.1.0
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
	return executeAsync(options, runReconcileAsync);
}

/**
 * Run the asset half of a deploy: apply non-place ops (minting IDs), persist
 * mutable asset fields, run codegen, and set the `pendingRebuild` marker at
 * the checkpoint. Builds and publishes no place. The minted-but-unpublished
 * state it leaves is exactly the one the marker models, so a later `publish`
 * (or the next `deploy`) republishes the affected places. Default-constructs
 * missing deps and resolves the progress port exactly as {@link deploy} does.
 *
 * @since 0.1.0
 *
 * @param options - Target environment plus optional overrides.
 * @returns The checkpoint `BedrockState` on success, or a stage-tagged
 *   `DeployError` on failure (a partial asset failure returns `applyFailed`
 *   with survivors and the marker persisted).
 * @example
 *
 * ```ts
 * import { provision } from "@bedrock-rbx/core";
 *
 * return provision({ environment: "production" }).then((result) => {
 *     expect(result.success).toBeFalse();
 *     if (!result.success) {
 *         expect(["configLoadFailed", "stateNotConfigured"]).toContain(result.err.kind);
 *     }
 * });
 * ```
 */
export async function provision(
	options: ProvisionOptions,
): Promise<Result<BedrockState, DeployError>> {
	return executeAsync(options, runProvisionAsync);
}

/**
 * Publish the on-disk artifact for every place under a `pendingRebuild`
 * marker, clearing the marker for each place actually republished. A pure
 * uploader: it mints nothing, runs no codegen, and builds no place. An
 * unchanged artifact (its file hash already matches state) is a no-op upload
 * that keeps its marker, so the place still shows as owing a rebuild until its
 * artifact changes. Default-constructs missing deps and resolves the progress
 * port exactly as {@link deploy} does.
 *
 * @since 0.1.0
 *
 * @param options - Target environment plus optional overrides.
 * @returns The persisted `BedrockState` on success, or a stage-tagged
 *   `DeployError` on failure.
 * @example
 *
 * ```ts
 * import { publish } from "@bedrock-rbx/core";
 *
 * return publish({ environment: "production" }).then((result) => {
 *     expect(result.success).toBeFalse();
 *     if (!result.success) {
 *         expect(["configLoadFailed", "stateNotConfigured"]).toContain(result.err.kind);
 *     }
 * });
 * ```
 */
export async function publish(options: PublishOptions): Promise<Result<BedrockState, DeployError>> {
	return executeAsync(options, runPublishAsync);
}

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}

function getEnvironmentOf(options: DeployOptions): (name: string) => string | undefined {
	return options.getEnv ?? readProcessEnvironment;
}

async function pickConfigAsync(options: DeployOptions): Promise<Result<Config, DeployError>> {
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

async function resolveEffectiveConfigAsync(options: DeployOptions): Promise<
	Result<
		{
			effective: ResolvedConfig;
			readFile: (path: string) => Promise<Uint8Array>;
			realDisplay: Readonly<Record<string, ResourceRealDisplay>>;
		},
		DeployError
	>
> {
	const config = await pickConfigAsync(options);
	if (!config.success) {
		return config;
	}

	const selected = resolveEnvironment(config.data, options.environment);
	if (!selected.success) {
		return { err: selected.err, success: false };
	}

	return {
		data: {
			effective: selected.data.config,
			readFile: options.readFile ?? nodeReadFile,
			realDisplay: selected.data.realDisplay,
		},
		success: true,
	};
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

function pickCodegen(
	options: DeployOptions,
	config: ResolvedConfig,
): Result<CodegenBundle | undefined, DeployError> {
	if (!isCodegenEnabled(config.codegen)) {
		return { data: undefined, success: true };
	}

	// No `emit` override falls back to the default Luau emitter, so an enabled
	// codegen always produces a file (zero-config); a supplied emitter may wrap
	// it. With no injected writer, output roots at `codegen.output` or, absent
	// that, the default `.bedrock/generated` directory.
	const emit =
		options.emit ??
		createDefaultEmitter({ typeDeclarations: config.codegen?.typeDeclarations });
	const writer =
		options.codegenWriter ??
		createFsCodegenWriter({ outputDir: resolveCodegenOutputDirectory(config.codegen) });

	return { data: { emit, writer }, success: true };
}

function pickDrivenDependencies({
	config,
	options,
	readFile,
}: PickRegistryInputs): Result<DrivenDependencies, DeployError> {
	const statePort = pickStatePort(options, config);
	if (!statePort.success) {
		return statePort;
	}

	const registry = pickRegistry({ config, options, readFile });
	if (!registry.success) {
		return registry;
	}

	const codegen = pickCodegen(options, config);
	if (!codegen.success) {
		return codegen;
	}

	return {
		data: { codegen: codegen.data, registry: registry.data, statePort: statePort.data },
		success: true,
	};
}

async function resolveDependenciesAsync(
	options: DeployOptions,
): Promise<Result<ResolvedDependenciesBase, DeployError>> {
	const base = await resolveEffectiveConfigAsync(options);
	if (!base.success) {
		return base;
	}

	const { effective, readFile, realDisplay } = base.data;
	const driven = pickDrivenDependencies({ config: effective, options, readFile });
	if (!driven.success) {
		return driven;
	}

	return {
		data: {
			...driven.data,
			build: options.build,
			config: effective,
			readFile,
			realDisplay,
		},
		success: true,
	};
}

function emitTerminalEvent({ environment, progress, result }: EmitTerminalEventInputs): void {
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

async function runAndEmitAsync({
	options,
	progress,
	runner,
}: RunContext): Promise<Result<BedrockState, DeployError>> {
	const resolved = await resolveDependenciesAsync(options);
	if (!resolved.success) {
		emitTerminalEvent({ environment: options.environment, progress, result: resolved });
		return resolved;
	}

	const result = await runner(options.environment, { ...resolved.data, progress });
	emitTerminalEvent({ environment: options.environment, progress, result });
	return result;
}

async function runWithDeferredProgressAsync(
	options: DeployOptions,
	runner: ReconcileRunner,
): Promise<Result<BedrockState, DeployError>> {
	const resolved = await resolveDependenciesAsync(options);
	const labelConfig = resolved.success ? resolved.data.config : options.config;
	const progress = createDefaultProgressAdapter(labelConfig);

	if (!resolved.success) {
		emitTerminalEvent({ environment: options.environment, progress, result: resolved });
		return resolved;
	}

	const result = await runner(options.environment, { ...resolved.data, progress });
	emitTerminalEvent({ environment: options.environment, progress, result });
	return result;
}

async function executeAsync(
	options: DeployOptions,
	runner: ReconcileRunner,
): Promise<Result<BedrockState, DeployError>> {
	if (options.progress !== undefined) {
		return runAndEmitAsync({ options, progress: options.progress, runner });
	}

	// A non-empty `BEDROCK_CLI` selects the clack-backed adapter (resolved after
	// the config loads, for its state-backend label); every other reading runs
	// silently through the no-op adapter.
	if (isCliEnvironmentFlagSet(getEnvironmentOf(options)("BEDROCK_CLI"))) {
		return runWithDeferredProgressAsync(options, runner);
	}

	return runAndEmitAsync({ options, progress: createNoOpProgressAdapter(), runner });
}

async function invokeBuildStepAsync(
	build: BuildStep,
	environment: string,
): Promise<Result<undefined, DeployError>> {
	// The step owns an arbitrary build; a throw leaves the checkpoint's outputs
	// and marker in place and surfaces a stage-tagged buildFailed error so the
	// publish stage never runs and the next green deploy self-heals.
	try {
		await build({ environment });
		return { data: undefined, success: true };
	} catch (err) {
		return {
			err: {
				kind: "buildFailed",
				reason: safeStringify(err),
			},
			success: false,
		};
	}
}

function finalize(
	pass: ReconcilePass,
	codegen: Result<Sha256Hex, CodegenError> | undefined,
): Result<BedrockState, DeployError> {
	// Check write before apply: only the write carries `unsavedState`.
	if (!pass.written.success) {
		return {
			err: {
				cause: pass.written.err,
				kind: "stateWriteFailed",
				unsavedState: pass.merged,
			},
			success: false,
		};
	}

	// Apply outranks codegen: a partial apply still emits codegen for the keys
	// that resolved, but the deploy result stays `applyFailed`.
	if (!pass.applied.success) {
		return { err: { cause: pass.applied.err, kind: "applyFailed" }, success: false };
	}

	if (codegen !== undefined && !codegen.success) {
		return { err: { cause: codegen.err, kind: "codegenFailed" }, success: false };
	}

	return { data: pass.merged, success: true };
}

function settleOwedPlaces({ ops, owed, survivors }: SettleOwedInputs): ReadonlySet<ResourceKey> {
	// A green pass settles an owed place two ways: it republished (a place
	// survivor of this pass) or its op noop'd because the on-disk artifact
	// already matches what is live. Only a place whose dispatched op failed
	// (absent from both sets) still owes a publish and keeps its marker.
	const settled = new Set([
		...survivors.filter((resource) => resource.kind === "place").map((entry) => entry.key),
		...ops.filter((op) => op.type === "noop" && op.kind === "place").map((entry) => entry.key),
	]);
	return new Set([...owed].filter((key) => !settled.has(key)));
}

async function runSettledPassAsync({
	deps,
	environment,
	ops,
	owedRebuild,
	priorResources,
	storedHash,
}: SettledPassInputs): Promise<Result<BedrockState, DeployError>> {
	// This pass never owns the fingerprint: it threads the stored hash back out
	// unchanged. No-op avoidance comes from the file-hash diff (an unchanged
	// artifact op is a noop), not from the codegen fingerprint.
	const pass = await applyAndPersistAsync({
		codegenHash: storedHash,
		environment,
		ops,
		pendingRebuild: (survivors) => settleOwedPlaces({ ops, owed: owedRebuild, survivors }),
		priorResources,
		progress: deps.progress,
		realDisplay: deps.realDisplay,
		registry: deps.registry,
		statePort: deps.statePort,
	});

	return finalize(pass, undefined);
}

async function resolveDesiredStateAsync(
	dependencies: ResolvedDependencies,
	includeKind?: (kind: ResourceKind) => boolean,
): Promise<Result<ReadonlyArray<ResourceDesiredState>, DeployError>> {
	const desired = await buildDesired({
		includeKind,
		readFile: dependencies.readFile,
		resources: flattenConfig(dependencies.config),
	});
	if (!desired.success) {
		return { err: { cause: desired.err, kind: "buildDesiredFailed" }, success: false };
	}

	return desired;
}

async function loadReconcileInputsAsync({
	dependencies,
	environment,
	includeKind,
}: {
	readonly dependencies: ResolvedDependencies;
	readonly environment: string;
	readonly includeKind?: (kind: ResourceKind) => boolean;
}): Promise<Result<ReconcileInputs, DeployError>> {
	const desired = await resolveDesiredStateAsync(dependencies, includeKind);
	if (!desired.success) {
		return desired;
	}

	const prior = await dependencies.statePort.read(environment);
	if (!prior.success) {
		return { err: { cause: prior.err, kind: "stateReadFailed" }, success: false };
	}

	const priorResources = prior.data?.resources ?? [];
	const validated = assertAllReconcilable(desired.data, priorResources);
	if (!validated.success) {
		return { err: { cause: validated.err, kind: "buildDesiredFailed" }, success: false };
	}

	return {
		data: {
			ops: diff(desired.data, priorResources),
			owedRebuild: prior.data?.pendingRebuild ?? new Set<ResourceKey>(),
			priorResources,
			storedHash: prior.data?.codegenHash,
		},
		success: true,
	};
}

async function runFusedPublishStageAsync(
	environment: string,
	deps: ResolvedDependencies,
): Promise<Result<BedrockState, DeployError>> {
	// Reload the place inputs after the build step so the diff hashes the
	// artifact the build just wrote; a place whose file hash already matches
	// state noop's, so an unchanged artifact is never uploaded. Because the
	// build ran green, a noop place is settled and its marker clears too.
	const loaded = await loadReconcileInputsAsync({
		dependencies: deps,
		environment,
		includeKind: (kind) => kind === "place",
	});
	if (!loaded.success) {
		return loaded;
	}

	const { ops, owedRebuild, priorResources, storedHash } = loaded.data;
	return runSettledPassAsync({ deps, environment, ops, owedRebuild, priorResources, storedHash });
}

async function runSinglePassReconcileAsync(
	environment: string,
	dependencies: ResolvedDependencies,
): Promise<Result<BedrockState, DeployError>> {
	const loaded = await loadReconcileInputsAsync({ dependencies, environment });
	if (!loaded.success) {
		return loaded;
	}

	const { ops, owedRebuild, priorResources, storedHash } = loaded.data;
	return runSettledPassAsync({
		deps: dependencies,
		environment,
		ops,
		owedRebuild,
		priorResources,
		storedHash,
	});
}

function declaredPlaceKeys(config: ResolvedConfig): ReadonlyArray<ResourceKey> {
	return flattenConfig(config)
		.filter((input) => input.kind === "place")
		.map((input) => input.key);
}

async function runCodegenStageAsync(
	dependencies: ResolvedDependencies,
	pass: ReconcilePass,
): Promise<Result<Sha256Hex, CodegenError> | undefined> {
	if (!pass.written.success || dependencies.codegen === undefined) {
		return undefined;
	}

	return runCodegenAsync({
		deployedState: pass.merged,
		emit: dependencies.codegen.emit,
		environments: Object.keys(dependencies.config.environments),
		statePort: dependencies.statePort,
		writer: dependencies.codegen.writer,
	});
}

async function runAssetStageAsync({
	deps,
	environment,
	markPlaces,
	ops,
	priorResources,
	storedHash,
}: AssetStageInputs): Promise<ReconcilePass> {
	// The checkpoint preserves the stored hash; the fingerprint is bookkeeping
	// only and no longer gates a rebuild decision.
	return applyAndPersistAsync({
		codegenHash: storedHash,
		environment,
		ops,
		pendingRebuild: new Set(markPlaces),
		priorResources,
		progress: deps.progress,
		realDisplay: deps.realDisplay,
		registry: deps.registry,
		statePort: deps.statePort,
	});
}

async function runProvisionStageAsync(inputs: AssetStageInputs): Promise<ProvisionStage> {
	const assetPass = await runAssetStageAsync(inputs);
	const codegen = await runCodegenStageAsync(inputs.deps, assetPass);
	// `finalize` returns a non-success outcome exactly when the stage must abort:
	// a partial asset failure (or failed checkpoint write) leaves survivors and
	// the marker persisted, and a codegen failure after the checkpoint retains
	// the stale hash; in every case the next run retries via the marker rather
	// than building against missing IDs. A success outcome means the checkpoint
	// is clean and a caller may proceed to a place stage.
	return { assetPass, codegen, outcome: finalize(assetPass, codegen) };
}

async function runProvisionAsync(
	environment: string,
	deps: ResolvedDependencies,
): Promise<Result<BedrockState, DeployError>> {
	// Reconcile assets only: provision never reads the place artifact, so it can
	// run before the place is built. Every declared place is marked for a later
	// publish, its key taken from config rather than a diffed op.
	const loaded = await loadReconcileInputsAsync({
		dependencies: deps,
		environment,
		includeKind: (kind) => kind !== "place",
	});
	if (!loaded.success) {
		return loaded;
	}

	const { ops, priorResources, storedHash } = loaded.data;
	const { outcome } = await runProvisionStageAsync({
		deps,
		environment,
		markPlaces: declaredPlaceKeys(deps.config),
		ops,
		priorResources,
		storedHash,
	});
	return outcome;
}

async function runReconcileAsync(
	environment: string,
	dependencies: ResolvedDependencies,
): Promise<Result<BedrockState, DeployError>> {
	// Without codegen there is nothing to build: publish the pre-built place
	// files in a single pass. A leftover pending-rebuild marker settles in the
	// same pass. Published or already-current places clear it, failures keep it.
	if (dependencies.codegen === undefined) {
		return runSinglePassReconcileAsync(environment, dependencies);
	}

	// With no place declared there is nothing to build or publish: provision
	// (asset ops plus codegen) is the whole deploy.
	if (declaredPlaceKeys(dependencies.config).length === 0) {
		return runProvisionAsync(environment, dependencies);
	}

	// A codegen project owes a freshly built artifact on every deploy, so the
	// fused pipeline needs a build step before anything is minted.
	if (dependencies.build === undefined) {
		return { err: { kind: "missingBuildStep" }, success: false };
	}

	const provisioned = await runProvisionAsync(environment, dependencies);
	if (!provisioned.success) {
		return provisioned;
	}

	const built = await invokeBuildStepAsync(dependencies.build, environment);
	if (!built.success) {
		return built;
	}

	return runFusedPublishStageAsync(environment, dependencies);
}

function remainingOwed(
	owedRebuild: ReadonlySet<ResourceKey>,
	survivors: ReadonlyArray<ResourceCurrentState>,
): ReadonlySet<ResourceKey> {
	// A survivor is a place that actually republished; clear its marker. A place
	// whose op noop'd (unchanged artifact) or failed is absent and keeps its
	// marker, so it still shows as owing a rebuild.
	const republished = new Set(survivors.map((resource) => resource.key));
	return new Set([...owedRebuild].filter((key) => !republished.has(key)));
}

async function runPublishAsync(
	environment: string,
	deps: ResolvedDependencies,
): Promise<Result<BedrockState, DeployError>> {
	// Reconcile places only: publish never reads asset files. Publish just the
	// places owing a rebuild; the diff already noop's a place whose on-disk
	// artifact hash matches state, so an unchanged artifact is not dispatched (no
	// upload). The stored hash threads through unchanged: publish runs no
	// codegen.
	const loaded = await loadReconcileInputsAsync({
		dependencies: deps,
		environment,
		includeKind: (kind) => kind === "place",
	});
	if (!loaded.success) {
		return loaded;
	}

	const { ops, owedRebuild, priorResources, storedHash } = loaded.data;
	const placeOps = ops.filter((op) => owedRebuild.has(op.key));
	const pass = await applyAndPersistAsync({
		codegenHash: storedHash,
		environment,
		ops: placeOps,
		pendingRebuild: (survivors) => remainingOwed(owedRebuild, survivors),
		priorResources,
		progress: deps.progress,
		realDisplay: deps.realDisplay,
		registry: deps.registry,
		statePort: deps.statePort,
	});
	return finalize(pass, undefined);
}
