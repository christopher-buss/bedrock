import type { Credential, Result } from "@bedrock-rbx/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";

import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { DeferredCreate } from "../core/capacity-check.ts";
import type { ConfigError } from "../core/config-error.ts";
import type { DeclarationReport } from "../core/declaration-report.ts";
import type { Operation } from "../core/operations.ts";
import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "../core/plugin-registry.ts";
import type { RedactionAnnotation } from "../core/redact-resources.ts";
import type { StateNotConfiguredError } from "../core/resolve-state-config.ts";
import type { Config, ResolvedConfig } from "../core/schema.ts";
import {
	type IncompleteBadgeEntryError,
	type IncompletePassEntryError,
	type IncompletePlaceEntryError,
	type IncompleteProductEntryError,
	type IncompleteUniverseEntryError,
	resolveEnvironment,
	type UnknownEnvironmentError,
} from "../core/select-environment.ts";
import type { StateError } from "../core/state.ts";
import type { StartPlaceFieldSkippedEvent } from "../ports/progress-port.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StateLockError, StateLockHolding, StateLockPort } from "../ports/state-lock-port.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { ResourceKey } from "../types/ids.ts";
import type { RegistryConfigError } from "./build-default-registry.ts";
import type { PluginStateBackendError, UnsupportedBackendError } from "./build-state-port.ts";
import { type FreeBadgeQuota, freeBadgeQuotaOf } from "./check-capacity.ts";
import { type LoadConfigOptions, type LoadedProject, loadProjectAsync } from "./load-config.ts";
import { readPreviewAnnotationsAsync } from "./preview-annotations.ts";
import { buildPreviewDesiredAsync, type PreviewDesired } from "./preview-desired.ts";
import {
	getEnvironmentOf,
	type PreviewBaseline,
	type PreviewLiveRegistryInputs,
	readPreviewLiveRegistryAsync,
} from "./preview-live-registry.ts";
import type { PreviewSpendOptions, SpendPreview } from "./preview-spend.ts";
import { pickStatePorts, type PreviewStatePorts } from "./preview-state-ports.ts";
import { createEnvironmentStateReader } from "./read-environment-state.ts";
import type { LiveCheckOptions } from "./read-live-state.ts";
import { type PreviewReconcileError, reconcilePreviewAsync } from "./reconcile-preview.ts";

/**
 * Inputs for a read-only diff preview. Missing dependencies are constructed
 * from config and BEDROCK_GITHUB_TOKEN (state) or BEDROCK_API_KEY (live reads).
 */
export interface PreviewDiffOptions extends LiveCheckOptions, PreviewSpendOptions {
	/**
	 * Pre-loaded, optionally-mutated project config. Omit to call
	 * `loadConfig()` automatically.
	 */
	readonly config?: Config;
	/**
	 * Credential for default live readers; otherwise reads BEDROCK_API_KEY.
	 * @since 0.5.0
	 */
	readonly credential?: Credential;
	/** Environment name; threaded into `StatePort.read`. */
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
	 * Loader invoked when `config` is omitted. Omit it too and the project
	 * loads through `loadProjectAsync`, which also registers what the
	 * config's `plugins` entries declared; a loader supplied here returns a
	 * config alone, so name its **Backend**s through `plugins` instead.
	 */
	readonly loadConfig?: (options?: LoadConfigOptions) => Promise<Result<Config, ConfigError>>;
	/**
	 * What the loaded plugins declared, which decides the **Backend**s
	 * `config.state.backend` can name beyond the builtins. Defaults to what
	 * the config load registered; supply it alongside a pre-loaded `config`
	 * so a plugin-declared **Backend** still resolves.
	 */
	readonly plugins?: PluginRegistry;
	/**
	 * Reads file bytes for resources that have file-backed inputs. Defaults to
	 * `node:fs/promises.readFile`.
	 */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/**
	 * Drivers used for live reads; supplied drivers own their authentication.
	 * @since 0.5.0
	 */
	readonly registry?: Partial<DriverRegistry> | undefined;
	/**
	 * Exclusion the **Backend** provides, asked - never taken - so a
	 * preview racing a deploy says so. Supplied alongside `statePort` when
	 * the caller supplies its own **Backend**; omit it to preview without
	 * reporting a hold.
	 */
	readonly stateLockPort?: StateLockPort;
	/**
	 * Backend used to read the prior snapshot. Default-constructed from
	 * `config.state` and `BEDROCK_GITHUB_TOKEN` when omitted.
	 * A supplied port also serves every environment's declaration report;
	 * otherwise each environment uses its own configured backend.
	 */
	readonly statePort?: StatePort;
}

/**
 * Stage-tagged preview failure, including an incomplete live read. Apply and
 * State-write failures cannot occur because the preview is read-only.
 */
export type PreviewDiffError =
	| IncompleteBadgeEntryError
	| IncompletePassEntryError
	| IncompletePlaceEntryError
	| IncompleteProductEntryError
	| IncompleteUniverseEntryError
	| PluginStateBackendError
	| PreviewReconcileError
	| RegistryConfigError
	| StateNotConfiguredError
	| UnknownEnvironmentError
	| UnsupportedBackendError
	| { readonly cause: ConfigError; readonly kind: "configLoadFailed" }
	| { readonly cause: StateError; readonly kind: "stateReadFailed" };

/** Successful preview output. */
export interface DiffPreview extends SpendPreview {
	/**
	 * Who held the **Environment** while the preview was computed, absent
	 * when nothing held it, when the **Backend** offers no exclusion, and
	 * when the lock store could not be asked.
	 *
	 * A preview takes no hold, so a deploy can be running against the
	 * **Environment** the whole time this was computed and the answer can
	 * already be behind. Reporting the holder is what says so.
	 */
	readonly concurrentHold?: StateLockHolding | undefined;
	/** Persisted cross-environment status of temporary config declarations. */
	readonly declarationReports?: ReadonlyArray<DeclarationReport>;
	/** Badge creates a Deploy would defer, in Key order; they stay in `ops`. */
	readonly deferredCreates?: ReadonlyArray<DeferredCreate>;
	/**
	 * Ordinary Drift, comparing saved Current state with Desired state.
	 * @since 0.5.0
	 */
	readonly drift?: ReadonlyArray<Operation>;
	/**
	 * Environment the preview was computed against; matches
	 * `options.environment`.
	 */
	readonly environment: string;
	/**
	 * Why the **Backend** could not say who holds the **Environment**,
	 * absent whenever it could.
	 *
	 * A lock store that cannot be reached is not an **Environment** nobody
	 * holds, and a preview that reported it as one would read as settled
	 * when it is only unasked. It never fails the preview: `read` does not
	 * write, and refusing to answer at all would queue read-only work
	 * behind a store outage the way taking a hold would.
	 */
	readonly holdUnknown?: StateLockError | undefined;
	/**
	 * Live items `importId` records as Current state before the Diff.
	 * @since 0.5.0
	 */
	readonly imports?: ReadonlyArray<import("./import-live.ts").ImportedResource>;
	/**
	 * Result of reading Live state before Diff.
	 * @since 0.5.0
	 */
	readonly liveCheck?: import("./read-live-state.ts").LiveCheck;
	/** Operations `diff` would apply during a deploy. */
	readonly ops: ReadonlyArray<Operation>;
	/**
	 * Place keys awaiting publication after provision. A green publish clears
	 * the marker; until then these keys count as drift.
	 */
	readonly pendingRebuild: ReadonlyArray<ResourceKey>;
	/**
	 * One entry per resource flagged redacted in the active environment.
	 * Surfaced so preview output can call out silent noops where the author's
	 * real-value edits stay in config but never reach Open Cloud.
	 */
	readonly redactions: ReadonlyArray<RedactionAnnotation>;
	/**
	 * Start place fields the Deploy would not write because the universe
	 * declares them too, one event per field, as the Deploy reports them.
	 *
	 * @since unreleased
	 */
	readonly startPlaceFieldSkips?: ReadonlyArray<StartPlaceFieldSkippedEvent>;
}

interface ResolvedDependencies extends LiveCheckOptions, PreviewStatePorts {
	readonly authoredConfig: Config;
	readonly badgeQuota: FreeBadgeQuota;
	readonly config: ResolvedConfig;
	readonly liveRegistry: PreviewLiveRegistryInputs;
	readonly readEnvironmentState: StatePort["read"];
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly redactions: ReadonlyArray<RedactionAnnotation>;
}

/**
 * Compute the operations `deploy` would apply for a target environment without
 * writing state. Default-constructs missing deps from the project config and
 * `BEDROCK_GITHUB_TOKEN`. Live reads use the supplied Drivers or credential,
 * otherwise BEDROCK_API_KEY; without a credential the check is visibly skipped.
 *
 * @param options - Target environment plus optional overrides.
 * @returns The computed operations on success, or a stage-tagged
 *   `PreviewDiffError` on failure.
 */
export async function previewDiffAsync(
	options: PreviewDiffOptions,
): Promise<Result<DiffPreview, PreviewDiffError>> {
	const resolved = await resolveDependenciesAsync(options);
	if (!resolved.success) {
		return resolved;
	}

	return runPreviewAsync(options.environment, resolved.data);
}

/**
 * Load the project through whichever loader the caller left in place, on
 * the same terms as `deploy`.
 *
 * @param options - The caller's preview options.
 * @returns The loaded project, or the config error the loader reported.
 */
async function loadProjectThroughAsync(
	options: PreviewDiffOptions,
): Promise<Result<LoadedProject, ConfigError>> {
	if (options.loadConfig === undefined) {
		return loadProjectAsync();
	}

	const loaded = await options.loadConfig();
	return loaded.success
		? { data: { config: loaded.data, plugins: EMPTY_PLUGIN_REGISTRY }, success: true }
		: loaded;
}

/**
 * Resolve the project config together with what the loaded plugins
 * declared, on the same terms as `deploy`: a pre-loaded config or an
 * injected loader carries no registry, so `options.plugins` is how a
 * programmatic caller names the **Backend**s available to it.
 *
 * @param options - The caller's preview options.
 * @returns The config and the registry its `state` block resolves against.
 */
async function pickConfigAsync(
	options: PreviewDiffOptions,
): Promise<Result<LoadedProject, PreviewDiffError>> {
	if (options.config !== undefined) {
		return {
			data: {
				config: options.config,
				plugins: options.plugins ?? EMPTY_PLUGIN_REGISTRY,
			},
			success: true,
		};
	}

	const loaded = await loadProjectThroughAsync(options);
	if (!loaded.success) {
		return { err: { cause: loaded.err, kind: "configLoadFailed" }, success: false };
	}

	return {
		data: {
			config: loaded.data.config,
			plugins: options.plugins ?? loaded.data.plugins,
		},
		success: true,
	};
}

function resolveEnvironmentView(
	config: Config,
	environment: string,
): Result<
	{ readonly effective: ResolvedConfig; readonly redactions: ReadonlyArray<RedactionAnnotation> },
	PreviewDiffError
> {
	const selected = resolveEnvironment(config, environment);
	if (!selected.success) {
		return { err: selected.err, success: false };
	}

	return {
		data: {
			effective: selected.data.config,
			redactions: selected.data.redactions,
		},
		success: true,
	};
}

function previewStateReader(
	options: PreviewDiffOptions,
	project: LoadedProject,
): StatePort["read"] {
	return createEnvironmentStateReader({
		...options,
		...project,
		getEnv: getEnvironmentOf(options),
	});
}

function previewLiveInputs(
	options: PreviewDiffOptions,
	backend: Pick<PreviewLiveRegistryInputs, "config" | "statePort">,
): PreviewLiveRegistryInputs {
	return {
		...options,
		...backend,
		getEnv: getEnvironmentOf(options),
		readFile: options.readFile ?? nodeReadFile,
	};
}

function resolveProjectDependencies(
	options: PreviewDiffOptions,
	project: LoadedProject,
): Result<ResolvedDependencies, PreviewDiffError> {
	const view = resolveEnvironmentView(project.config, options.environment);
	if (!view.success) {
		return view;
	}

	const { effective, redactions } = view.data;
	const backend = pickStatePorts(options, { config: effective, plugins: project.plugins });
	if (!backend.success) {
		return backend;
	}

	return {
		data: {
			...options,
			...backend.data,
			authoredConfig: project.config,
			badgeQuota: freeBadgeQuotaOf(options, effective),
			config: effective,
			liveRegistry: previewLiveInputs(options, {
				config: effective,
				statePort: backend.data.statePort,
			}),
			readEnvironmentState: previewStateReader(options, project),
			readFile: options.readFile ?? nodeReadFile,
			redactions,
		},
		success: true,
	};
}

async function resolveDependenciesAsync(
	options: PreviewDiffOptions,
): Promise<Result<ResolvedDependencies, PreviewDiffError>> {
	const config = await pickConfigAsync(options);
	if (!config.success) {
		return config;
	}

	return resolveProjectDependencies(options, config.data);
}

async function finishPreviewAsync({
	dependencies,
	desired,
	environment,
	prior,
}: {
	readonly dependencies: ResolvedDependencies;
	readonly desired: PreviewDesired;
	readonly environment: string;
	readonly prior: PreviewBaseline;
}): Promise<Result<DiffPreview, PreviewDiffError>> {
	const rebound = await reconcilePreviewAsync({
		...dependencies,
		config: desired.config,
		desired: desired.desired,
		environment,
		prior: prior.state,
		registry: prior.registry,
	});
	if (!rebound.success) {
		return rebound;
	}

	const known = { environment, state: prior.state };
	return {
		data: {
			...(await readPreviewAnnotationsAsync(dependencies, known)),
			...rebound.data,
			environment,
			redactions: dependencies.redactions,
			startPlaceFieldSkips: desired.skipped,
		},
		success: true,
	};
}

async function runPreviewAsync(
	environment: string,
	dependencies: ResolvedDependencies,
): Promise<Result<DiffPreview, PreviewDiffError>> {
	const prior = await readPreviewLiveRegistryAsync(environment, dependencies.liveRegistry);
	if (!prior.success) {
		return prior;
	}

	const desired = await buildPreviewDesiredAsync({
		...dependencies,
		environment,
		universe: prior.data.registry?.universe,
	});
	if (!desired.success) {
		return desired;
	}

	return finishPreviewAsync({
		dependencies,
		desired: desired.data,
		environment,
		prior: prior.data,
	});
}
