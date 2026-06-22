/* eslint-disable max-lines -- deploy orchestration shell; the reconcile pipeline and its dependency resolution are one cohesive module. */
import type { Result } from "@bedrock-rbx/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";
import process from "node:process";

import { createDefaultProgressAdapter } from "../adapters/clack-progress-adapter.ts";
import { createFsCodegenWriter } from "../adapters/fs-codegen-writer.ts";
import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import { createNoOpProgressAdapter } from "../adapters/no-op-progress-adapter.ts";
import { assertAllReconcilable } from "../core/assert-all-reconcilable.ts";
import { buildRepublishOps } from "../core/build-republish-ops.ts";
import { type Emitter, isCodegenEnabled } from "../core/codegen.ts";
import type { ConfigError } from "../core/config-error.ts";
import { diff } from "../core/diff.ts";
import { flattenConfig } from "../core/flatten.ts";
import type { Operation } from "../core/operations.ts";
import { planTwoPhase, type TwoPhasePlan } from "../core/plan-two-phase.ts";
import type { RebuildHook, RebuiltPlace } from "../core/rebuild.ts";
import { resolveStateConfig, type StateNotConfiguredError } from "../core/resolve-state-config.ts";
import type {
	PlaceDesiredState,
	ResourceCurrentState,
	ResourceDesiredState,
} from "../core/resources.ts";
import type { Config, ResolvedConfig } from "../core/schema.ts";
import {
	type IncompletePassEntryError,
	type IncompletePlaceEntryError,
	type IncompleteUniverseEntryError,
	selectEnvironment,
	type UnknownEnvironmentError,
} from "../core/select-environment.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { AggregateApplyError } from "./apply-ops.ts";
import { buildDefaultRegistry, type RegistryConfigError } from "./build-default-registry.ts";
import { buildDesired, type BuildDesiredError } from "./build-desired.ts";
import {
	buildStatePort,
	type MissingCredentialError,
	type UnsupportedBackendError,
} from "./build-state-port.ts";
import { loadConfig as defaultLoadConfig, type LoadConfigOptions } from "./load-config.ts";
import { applyAndPersist, type ReconcilePass } from "./reconcile-pass.ts";
import { type CodegenError, runCodegen } from "./run-codegen.ts";

/**
 * Inputs for `deploy`. Every field except `environment` is optional;
 * omitted dependencies are default-constructed from the project config
 * and the environment variables `BEDROCK_GITHUB_TOKEN` and `BEDROCK_API_KEY`.
 */
export interface DeployOptions {
	/**
	 * Writer for codegen output; defaults to a node-fs writer rooted at
	 * `config.codegen.output`. Supplied to fake the write step at this seam.
	 * Only consulted when codegen is enabled and `emit` is supplied.
	 */
	readonly codegenWriter?: CodegenWriterPort;
	/** Pre-loaded, optionally-mutated project config. Omit to call `loadConfig()` automatically. */
	readonly config?: Config;
	/**
	 * Codegen emitter. Supplied programmatically (a function cannot round-trip
	 * through a config file). When codegen is enabled in config and this is
	 * supplied, `deploy` runs it after a successful state write.
	 */
	readonly emit?: Emitter;
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
	/**
	 * Two-phase rebuild hook. Supplied programmatically (a function cannot
	 * round-trip through a config file). When supplied and the diff contains a
	 * provisioned `create`, `deploy` mints the assets, runs codegen, invokes the
	 * hook with the post-asset-stage state, then republishes each returned place
	 * from the hook's rebuilt bytes. Omit to publish places in a single pass.
	 */
	readonly rebuild?: RebuildHook;
	/** Per-kind driver table consulted for create / update dispatch. Default-constructed from `BEDROCK_API_KEY` when omitted. */
	readonly registry?: DriverRegistry;
	/** Backend used to read the prior snapshot and persist the new one. Default-constructed from `config.state` and `BEDROCK_GITHUB_TOKEN` when omitted. */
	readonly statePort?: StatePort;
}

/**
 * Failure surfaced by `deploy`. Stage-tagged so callers can branch on
 * `kind` to distinguish reconciliation failures (`stateReadFailed`,
 * `applyFailed`, `codegenFailed`, ...) from default-construction failures
 * (`configLoadFailed`, `stateNotConfigured`, `unknownEnvironment`,
 * `incompletePlaceEntry`, `incompleteUniverseEntry`, `missingCredential`,
 * `unsupportedBackend`, `registryConfigMissing`, `codegenOutputMissing`).
 * `codegenFailed` cannot mask an `applyFailed`: a partial apply still emits
 * codegen for the keys that resolved, but the returned error stays
 * `applyFailed`.
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
	| { readonly cause: CodegenError; readonly kind: "codegenFailed" }
	| { readonly cause: ConfigError; readonly kind: "configLoadFailed" }
	| { readonly cause: StateError; readonly kind: "stateReadFailed" }
	| {
			readonly cause: StateError;
			readonly kind: "stateWriteFailed";
			readonly unsavedState: BedrockState;
	  }
	| { readonly kind: "codegenOutputMissing" };

/** Resolved codegen dependencies; present only when codegen is active. */
interface CodegenBundle {
	readonly emit: Emitter;
	readonly writer: CodegenWriterPort;
}

interface ResolvedDepsBase {
	readonly codegen: CodegenBundle | undefined;
	readonly config: ResolvedConfig;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly rebuild: RebuildHook | undefined;
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

interface SinglePassInputs {
	readonly deps: ResolvedDeps;
	readonly environment: string;
	readonly ops: ReadonlyArray<Operation>;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
}

interface TwoPhaseInputs {
	readonly deps: ResolvedDeps;
	readonly desired: ReadonlyArray<ResourceDesiredState>;
	readonly environment: string;
	readonly plan: TwoPhasePlan;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
	readonly rebuild: RebuildHook;
}

interface AssetStageInputs {
	readonly deps: ResolvedDeps;
	readonly desiredPlaces: ReadonlyArray<PlaceDesiredState>;
	readonly environment: string;
	readonly ops: ReadonlyArray<Operation>;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
}

interface RepublishStageInputs {
	readonly assetPass: ReconcilePass;
	readonly deps: ResolvedDeps;
	readonly desiredPlaces: ReadonlyArray<PlaceDesiredState>;
	readonly environment: string;
	readonly rebuilt: ReadonlyArray<RebuiltPlace>;
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
	if (!isCodegenEnabled(config.codegen) || options.emit === undefined) {
		return { data: undefined, success: true };
	}

	if (options.codegenWriter !== undefined) {
		return { data: { emit: options.emit, writer: options.codegenWriter }, success: true };
	}

	const output = config.codegen?.output;
	if (output === undefined) {
		return { err: { kind: "codegenOutputMissing" }, success: false };
	}

	return {
		data: { emit: options.emit, writer: createFsCodegenWriter({ outputDir: output }) },
		success: true,
	};
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

async function resolveEffectiveConfig(
	options: DeployOptions,
): Promise<
	Result<
		{ effective: ResolvedConfig; readFile: (path: string) => Promise<Uint8Array> },
		DeployError
	>
> {
	const config = await pickConfig(options);
	if (!config.success) {
		return config;
	}

	const selected = selectEnvironment(config.data, options.environment);
	if (!selected.success) {
		return { err: selected.err, success: false };
	}

	return {
		data: { effective: selected.data, readFile: options.readFile ?? nodeReadFile },
		success: true,
	};
}

async function resolveDeps(options: DeployOptions): Promise<Result<ResolvedDepsBase, DeployError>> {
	const base = await resolveEffectiveConfig(options);
	if (!base.success) {
		return base;
	}

	const { effective, readFile } = base.data;
	const statePort = pickStatePort(options, effective);
	if (!statePort.success) {
		return statePort;
	}

	const registry = pickRegistry({ config: effective, options, readFile });
	if (!registry.success) {
		return registry;
	}

	const codegen = pickCodegen(options, effective);
	if (!codegen.success) {
		return codegen;
	}

	return {
		data: {
			codegen: codegen.data,
			config: effective,
			readFile,
			rebuild: options.rebuild,
			registry: registry.data,
			statePort: statePort.data,
		},
		success: true,
	};
}

function finalize(
	pass: ReconcilePass,
	codegen: Result<void, CodegenError> | undefined,
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

async function runCodegenStage(
	deps: ResolvedDeps,
	pass: ReconcilePass,
): Promise<Result<void, CodegenError> | undefined> {
	if (!pass.written.success || deps.codegen === undefined) {
		return undefined;
	}

	return runCodegen({
		deployedState: pass.merged,
		emit: deps.codegen.emit,
		environments: Object.keys(deps.config.environments),
		statePort: deps.statePort,
		writer: deps.codegen.writer,
	});
}

async function runSinglePass(inputs: SinglePassInputs): Promise<Result<BedrockState, DeployError>> {
	const { deps, environment, ops, priorResources } = inputs;
	const pass = await applyAndPersist({
		environment,
		ops,
		priorResources,
		progress: deps.progress,
		registry: deps.registry,
		statePort: deps.statePort,
	});

	const codegen = await runCodegenStage(deps, pass);
	return finalize(pass, codegen);
}

async function runAssetStage(inputs: AssetStageInputs): Promise<ReconcilePass> {
	const { deps, desiredPlaces, environment, ops, priorResources } = inputs;
	return applyAndPersist({
		environment,
		ops,
		pendingRebuild: new Set(desiredPlaces.map((place) => place.key)),
		priorResources,
		progress: deps.progress,
		registry: deps.registry,
		statePort: deps.statePort,
	});
}

async function runRepublishStage(inputs: RepublishStageInputs): Promise<ReconcilePass> {
	const { assetPass, deps, desiredPlaces, environment, rebuilt } = inputs;
	const artifacts = new Map(rebuilt.map((place) => [place.key, place.bytes]));
	// Clear the marker only for the places the hook actually republished; any
	// declared place the hook skipped still owes a rebuild and keeps its marker.
	const stillOwed = new Set(
		desiredPlaces.map((place) => place.key).filter((key) => !artifacts.has(key)),
	);
	return applyAndPersist({
		artifacts,
		environment,
		ops: buildRepublishOps({
			currentResources: assetPass.merged.resources,
			desiredPlaces,
			keys: [...artifacts.keys()],
		}),
		pendingRebuild: stillOwed,
		priorResources: assetPass.merged.resources,
		progress: deps.progress,
		registry: deps.registry,
		statePort: deps.statePort,
	});
}

async function runTwoPhase(inputs: TwoPhaseInputs): Promise<Result<BedrockState, DeployError>> {
	const { deps, desired, environment, plan, priorResources, rebuild } = inputs;
	const desiredPlaces = desired.filter(
		(entry): entry is PlaceDesiredState => entry.kind === "place",
	);
	const assetPass = await runAssetStage({
		deps,
		desiredPlaces,
		environment,
		ops: plan.assetOps,
		priorResources,
	});

	const codegen = await runCodegenStage(deps, assetPass);
	const rebuilt = await rebuild({ state: assetPass.merged });
	const republishPass = await runRepublishStage({
		assetPass,
		deps,
		desiredPlaces,
		environment,
		rebuilt,
	});

	return finalize(republishPass, codegen);
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
	const { rebuild } = deps;
	if (rebuild === undefined) {
		return runSinglePass({ deps, environment, ops, priorResources });
	}

	const plan = planTwoPhase(ops, true);
	if (!plan.activates) {
		return runSinglePass({ deps, environment, ops, priorResources });
	}

	return runTwoPhase({ deps, desired: desired.data, environment, plan, priorResources, rebuild });
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
