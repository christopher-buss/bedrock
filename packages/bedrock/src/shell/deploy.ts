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
import { createDefaultEmitter, resolveCodegenOutputDirectory } from "../core/default-emitter.ts";
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
	ResourceRealDisplay,
} from "../core/resources.ts";
import type { Config, ResolvedConfig } from "../core/schema.ts";
import {
	type IncompletePassEntryError,
	type IncompletePlaceEntryError,
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
	type UnsupportedBackendError,
} from "./build-state-port.ts";
import { loadConfig as defaultLoadConfig, type LoadConfigOptions } from "./load-config.ts";
import { applyAndPersist, type ReconcilePass } from "./reconcile-pass.ts";
import { type CodegenError, runCodegen } from "./run-codegen.ts";

/**
 * Inputs for `deploy`. Every field except `environment` is optional;
 * omitted dependencies are default-constructed from the project config
 * and the environment variables `BEDROCK_GITHUB_TOKEN` and `BEDROCK_API_KEY`.
 *
 * @since 0.1.0
 */
export interface DeployOptions {
	/**
	 * Escape hatch for a deploy stuck behind a pending-rebuild marker. When
	 * `true`, the incoming marker is treated as cleared: the deploy neither
	 * re-activates two-phase from it nor hard-errors when no rebuild hook is
	 * available, and the normal state write drops the marker. Use it to abandon
	 * two-phase after dropping the rebuild hook; the place still publishes from
	 * its pre-built file in a single pass. Omit (defaults to `false`) to honor
	 * the marker.
	 */
	readonly clearPendingRebuild?: boolean;
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
	 * round-trip through a config file). When supplied alongside active codegen,
	 * `deploy` mints the assets, runs codegen, and rebuilds + republishes each
	 * place from the hook's bytes whenever the emitted source would change (its
	 * fingerprint differs from the stored one) — otherwise it publishes the
	 * pre-built file. Because the rebuild re-runs the build after codegen
	 * rewrites source, the deploy environment needs the build toolchain, not just
	 * a pre-built artifact. Omit, or run without codegen, to publish places in a
	 * single pass.
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
 * `applyFailed`, `codegenFailed`, `rebuildHookThrew`,
 * `pendingRebuildWithoutHook`, ...) from default-construction failures
 * (`configLoadFailed`, `stateNotConfigured`, `unknownEnvironment`,
 * `incompletePlaceEntry`, `incompleteUniverseEntry`, `missingCredential`,
 * `unsupportedBackend`, `registryConfigMissing`).
 * `codegenFailed` cannot mask an `applyFailed`: a partial apply still emits
 * codegen for the keys that resolved, but the returned error stays
 * `applyFailed`. A two-phase deploy whose asset stage partially fails aborts
 * the rebuild and returns `applyFailed`; a rebuild hook that throws returns
 * `rebuildHookThrew` with the checkpoint's outputs and marker still persisted;
 * a marker present with no rebuild hook available returns
 * `pendingRebuildWithoutHook` rather than reporting success over a stale place.
 *
 * @since 0.1.0
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
	| { readonly keys: ReadonlyArray<ResourceKey>; readonly kind: "pendingRebuildWithoutHook" }
	| { readonly kind: "rebuildHookThrew"; readonly reason: string };

/** Resolved codegen dependencies; present only when codegen is active. */
interface CodegenBundle {
	readonly emit: Emitter;
	readonly writer: CodegenWriterPort;
}

interface ResolvedDepsBase {
	readonly clearPendingRebuild: boolean;
	readonly codegen: CodegenBundle | undefined;
	readonly config: ResolvedConfig;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly realDisplay: Readonly<Record<string, ResourceRealDisplay>>;
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
	readonly storedHash: Sha256Hex | undefined;
}

interface TwoPhaseInputs {
	readonly deps: ResolvedDeps;
	readonly desired: ReadonlyArray<ResourceDesiredState>;
	readonly environment: string;
	readonly marker: ReadonlySet<ResourceKey>;
	readonly plan: TwoPhasePlan;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
	readonly rebuild: RebuildHook;
	readonly storedHash: Sha256Hex | undefined;
}

interface CompleteTwoPhaseInputs extends TwoPhaseInputs {
	readonly assetPass: ReconcilePass;
	readonly codegen: Result<Sha256Hex, CodegenError> | undefined;
}

interface AssetStageInputs {
	readonly deps: ResolvedDeps;
	readonly environment: string;
	readonly markPlaces: ReadonlyArray<ResourceKey>;
	readonly ops: ReadonlyArray<Operation>;
	readonly priorResources: ReadonlyArray<ResourceCurrentState>;
	readonly storedHash: Sha256Hex | undefined;
}

interface PublishStageInputs {
	readonly assetPass: ReconcilePass;
	readonly codegen: Result<Sha256Hex, CodegenError> | undefined;
	readonly codegenHash: Sha256Hex | undefined;
	readonly deps: ResolvedDeps;
	readonly environment: string;
	readonly placeOps: ReadonlyArray<Operation>;
}

interface RepublishStageInputs {
	readonly assetPass: ReconcilePass;
	readonly codegenHash: Sha256Hex | undefined;
	readonly deps: ResolvedDeps;
	readonly desiredPlaces: ReadonlyArray<PlaceDesiredState>;
	readonly environment: string;
	readonly rebuilt: ReadonlyArray<RebuiltPlace>;
}

/** Driven dependencies picked from environment and config once the effective config resolves. */
interface DrivenDeps {
	readonly codegen: CodegenBundle | undefined;
	readonly registry: DriverRegistry;
	readonly statePort: StatePort;
}

interface ReconcileInputs {
	readonly desired: ReadonlyArray<ResourceDesiredState>;
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
 * Run a full reconcile end-to-end. Default-constructs missing deps from
 * the project config and the environment variables `BEDROCK_GITHUB_TOKEN`
 * and `BEDROCK_API_KEY`; emits a terminal `deploySuccess` or `deployFailure`
 * event through the resolved `progress` port. When `progress` is omitted,
 * the default port comes from `BEDROCK_CLI`: a non-empty value selects the
 * clack-backed adapter, any other reading selects the no-op adapter. No
 * environment lookups happen when `statePort`, `registry`, `config`, and
 * `progress` are all supplied explicitly.
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

async function resolveEffectiveConfig(options: DeployOptions): Promise<
	Result<
		{
			effective: ResolvedConfig;
			readFile: (path: string) => Promise<Uint8Array>;
			realDisplay: Readonly<Record<string, ResourceRealDisplay>>;
		},
		DeployError
	>
> {
	const config = await pickConfig(options);
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

function pickDrivenDeps(inputs: PickRegistryInputs): Result<DrivenDeps, DeployError> {
	const { config, options, readFile } = inputs;
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

async function resolveDeps(options: DeployOptions): Promise<Result<ResolvedDepsBase, DeployError>> {
	const base = await resolveEffectiveConfig(options);
	if (!base.success) {
		return base;
	}

	const { effective, readFile, realDisplay } = base.data;
	const driven = pickDrivenDeps({ config: effective, options, readFile });
	if (!driven.success) {
		return driven;
	}

	return {
		data: {
			...driven.data,
			clearPendingRebuild: options.clearPendingRebuild ?? false,
			config: effective,
			readFile,
			realDisplay,
			rebuild: options.rebuild,
		},
		success: true,
	};
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

async function runCodegenStage(
	deps: ResolvedDeps,
	pass: ReconcilePass,
): Promise<Result<Sha256Hex, CodegenError> | undefined> {
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
	const { deps, environment, ops, priorResources, storedHash } = inputs;
	// A single pass never owns the fingerprint: it threads the stored hash back
	// out unchanged so a codegen-only (no rebuild hook) deploy never claims the
	// place was built against newly emitted source it could not have republished.
	const pass = await applyAndPersist({
		codegenHash: storedHash,
		environment,
		ops,
		priorResources,
		progress: deps.progress,
		realDisplay: deps.realDisplay,
		registry: deps.registry,
		statePort: deps.statePort,
	});

	const codegen = await runCodegenStage(deps, pass);
	return finalize(pass, codegen);
}

async function runAssetStage(inputs: AssetStageInputs): Promise<ReconcilePass> {
	const { deps, environment, markPlaces, ops, priorResources, storedHash } = inputs;
	// The checkpoint preserves the stored hash: only the write that completes a
	// successful republish (or pre-built publish) advances it, so an aborted
	// rebuild retains the stale hash and the next deploy retries.
	return applyAndPersist({
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

async function runRepublishStage(inputs: RepublishStageInputs): Promise<ReconcilePass> {
	const { assetPass, codegenHash, deps, desiredPlaces, environment, rebuilt } = inputs;
	const artifacts = new Map(rebuilt.map((place) => [place.key, place.bytes]));
	// Clear the marker only for the places the hook actually republished; any
	// declared place the hook skipped still owes a rebuild and keeps its marker.
	const stillOwed = new Set(
		desiredPlaces.map((place) => place.key).filter((key) => !artifacts.has(key)),
	);
	return applyAndPersist({
		artifacts,
		codegenHash,
		environment,
		ops: buildRepublishOps({
			currentResources: assetPass.merged.resources,
			desiredPlaces,
			keys: [...artifacts.keys()],
		}),
		pendingRebuild: stillOwed,
		priorResources: assetPass.merged.resources,
		progress: deps.progress,
		realDisplay: deps.realDisplay,
		registry: deps.registry,
		statePort: deps.statePort,
	});
}

async function runPublishStage(
	inputs: PublishStageInputs,
): Promise<Result<BedrockState, DeployError>> {
	const { assetPass, codegen, codegenHash, deps, environment, placeOps } = inputs;
	// Codegen output matched the stored hash, so the pre-built place file is
	// still current: replay the withheld place ops (the driver reads the file
	// from disk), clear the marker — nothing owes a rebuild — and advance the
	// stored hash to the value just emitted.
	const publishPass = await applyAndPersist({
		codegenHash,
		environment,
		ops: placeOps,
		pendingRebuild: new Set(),
		priorResources: assetPass.merged.resources,
		progress: deps.progress,
		realDisplay: deps.realDisplay,
		registry: deps.registry,
		statePort: deps.statePort,
	});
	return finalize(publishPass, codegen);
}

async function invokeRebuildHook(
	rebuild: RebuildHook,
	state: BedrockState,
): Promise<Result<ReadonlyArray<RebuiltPlace>, DeployError>> {
	// The hook owns an arbitrary build; a throw leaves the checkpoint's outputs
	// and marker in place and surfaces a stage-tagged rebuildHookThrew error so
	// the republish stage never runs.
	try {
		return { data: await rebuild({ state }), success: true };
	} catch (err) {
		return {
			err: {
				kind: "rebuildHookThrew",
				reason: err instanceof Error ? err.message : String(err),
			},
			success: false,
		};
	}
}

async function completeTwoPhase(
	inputs: CompleteTwoPhaseInputs,
): Promise<Result<BedrockState, DeployError>> {
	const { assetPass, codegen, deps, desired, environment, marker, plan, rebuild, storedHash } =
		inputs;
	const emittedHash = codegen?.success === true ? codegen.data : undefined;
	const nextHash = emittedHash ?? storedHash;
	// Rebuild when a leftover marker forces it or the freshly emitted codegen
	// would differ from what the published place was last built against. A
	// provisioned create changes the emitted output, so its hash differs — the
	// create trigger is subsumed here, not duplicated.
	const shouldRebuild =
		marker.size > 0 || (emittedHash !== undefined && emittedHash !== storedHash);

	if (!shouldRebuild) {
		const args = { assetPass, codegen, codegenHash: nextHash, deps, environment };
		return runPublishStage({ ...args, placeOps: plan.placeOps });
	}

	const rebuilt = await invokeRebuildHook(rebuild, assetPass.merged);
	if (!rebuilt.success) {
		return rebuilt;
	}

	const desiredPlaces = desired.filter(
		(entry): entry is PlaceDesiredState => entry.kind === "place",
	);
	const republishPass = await runRepublishStage({
		assetPass,
		codegenHash: nextHash,
		deps,
		desiredPlaces,
		environment,
		rebuilt: rebuilt.data,
	});

	return finalize(republishPass, codegen);
}

async function runTwoPhase(inputs: TwoPhaseInputs): Promise<Result<BedrockState, DeployError>> {
	const { deps, environment, plan, priorResources, storedHash } = inputs;
	const assetPass = await runAssetStage({
		deps,
		environment,
		markPlaces: plan.markPlaces,
		ops: plan.assetOps,
		priorResources,
		storedHash,
	});

	const codegen = await runCodegenStage(deps, assetPass);

	// A partial asset failure (or a failed checkpoint write) aborts the rebuild:
	// survivors and the marker are already persisted, codegen has emitted the
	// resolved keys, and the asset-stage error stands so the next run retries
	// via the marker instead of rebuilding against missing IDs. A codegen failure
	// after the checkpoint aborts too: with no fresh hash the rebuild decision
	// cannot be made, so the marker and the stale hash are retained.
	if (!assetPass.written.success || !assetPass.applied.success) {
		return finalize(assetPass, codegen);
	}

	if (codegen !== undefined && !codegen.success) {
		return finalize(assetPass, codegen);
	}

	return completeTwoPhase({ ...inputs, assetPass, codegen });
}

async function loadReconcileInputs(
	environment: string,
	deps: ResolvedDeps,
): Promise<Result<ReconcileInputs, DeployError>> {
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

	return {
		data: {
			desired: desired.data,
			ops: diff(desired.data, priorResources),
			owedRebuild: prior.data?.pendingRebuild ?? new Set<ResourceKey>(),
			priorResources,
			storedHash: prior.data?.codegenHash,
		},
		success: true,
	};
}

function markerWithoutHookError(inputs: {
	owedRebuild: ReadonlySet<ResourceKey>;
	rebuild: RebuildHook | undefined;
	shouldClearMarker: boolean;
}): DeployError | undefined {
	const { owedRebuild, rebuild, shouldClearMarker } = inputs;
	// A marker present with no hook to satisfy it is a hard error: refuse to
	// report success while a rebuild is owed and cannot be performed. The escape
	// hatch lets a user deliberately abandoning two-phase clear it instead.
	if (!shouldClearMarker && owedRebuild.size > 0 && rebuild === undefined) {
		return { keys: [...owedRebuild], kind: "pendingRebuildWithoutHook" };
	}

	return undefined;
}

async function runReconcile(
	environment: string,
	deps: ResolvedDeps,
): Promise<Result<BedrockState, DeployError>> {
	const loaded = await loadReconcileInputs(environment, deps);
	if (!loaded.success) {
		return loaded;
	}

	const { desired, ops, owedRebuild, priorResources, storedHash } = loaded.data;
	const { clearPendingRebuild: shouldClearMarker, codegen, rebuild } = deps;

	const owedError = markerWithoutHookError({ owedRebuild, rebuild, shouldClearMarker });
	if (owedError !== undefined) {
		return { err: owedError, success: false };
	}

	const marker = shouldClearMarker ? new Set<ResourceKey>() : owedRebuild;
	// Two-phase activates only when a rebuild hook is available and there is
	// something for the post-codegen check to act on: active codegen (whose hash
	// drives the rebuild decision) or a leftover marker forcing a retry. Without
	// codegen there is no generated source to fingerprint, so a rebuild hook is
	// inert and the deploy publishes the pre-built file in a single pass.
	if (rebuild === undefined || (codegen === undefined && marker.size === 0)) {
		return runSinglePass({ deps, environment, ops, priorResources, storedHash });
	}

	return runTwoPhase({
		deps,
		desired,
		environment,
		marker,
		plan: planTwoPhase(ops),
		priorResources,
		rebuild,
		storedHash,
	});
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
