import type { Result } from "@bedrock-rbx/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";
import process from "node:process";

import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import { assertAllReconcilable } from "../core/assert-all-reconcilable.ts";
import type { ConfigError } from "../core/config-error.ts";
import { diff } from "../core/diff.ts";
import { flattenConfig } from "../core/flatten.ts";
import type { Operation } from "../core/operations.ts";
import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "../core/plugin-registry.ts";
import { collectRedactionAnnotations, type RedactionAnnotation } from "../core/redact-resources.ts";
import { resolveStateConfig, type StateNotConfiguredError } from "../core/resolve-state-config.ts";
import type { Config, ResolvedConfig } from "../core/schema.ts";
import {
	extractResourceRedaction,
	type IncompletePassEntryError,
	type IncompletePlaceEntryError,
	type IncompleteProductEntryError,
	type IncompleteUniverseEntryError,
	selectEnvironment,
	selectMergedEnvironment,
	type UnknownEnvironmentError,
} from "../core/select-environment.ts";
import type { StateError } from "../core/state.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { ResourceKey } from "../types/ids.ts";
import { buildDesired, type BuildDesiredError } from "./build-desired.ts";
import {
	buildStatePort,
	type MissingCredentialError,
	type PluginStateBackendError,
	type UnsupportedBackendError,
} from "./build-state-port.ts";
import { type LoadConfigOptions, type LoadedProject, loadProjectAsync } from "./load-config.ts";

/**
 * Inputs for `previewDiff`. Mirrors `DeployOptions` minus the apply-side
 * dependencies (`registry`); every field except `environment` is optional
 * and default-constructed from the project config and the environment
 * variables `BEDROCK_GITHUB_TOKEN` (gist state backend) when omitted.
 */
export interface PreviewDiffOptions {
	/**
	 * Pre-loaded, optionally-mutated project config. Omit to call
	 * `loadConfig()` automatically.
	 */
	readonly config?: Config;
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
	 * Backend used to read the prior snapshot. Default-constructed from
	 * `config.state` and `BEDROCK_GITHUB_TOKEN` when omitted.
	 */
	readonly statePort?: StatePort;
}

/**
 * Failure surfaced by `previewDiff`. Stage-tagged so callers can branch on
 * `kind`. Strict subset of `DeployError`: every variant here is also a
 * `DeployError` variant, but the apply-side variants (`applyFailed`,
 * `stateWriteFailed`) cannot occur because `previewDiff` is read-only.
 */
export type PreviewDiffError =
	| IncompletePassEntryError
	| IncompletePlaceEntryError
	| IncompleteProductEntryError
	| IncompleteUniverseEntryError
	| MissingCredentialError
	| PluginStateBackendError
	| StateNotConfiguredError
	| UnknownEnvironmentError
	| UnsupportedBackendError
	| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" }
	| { readonly cause: ConfigError; readonly kind: "configLoadFailed" }
	| { readonly cause: StateError; readonly kind: "stateReadFailed" };

/** Successful preview output. */
export interface DiffPreview {
	/**
	 * Environment the preview was computed against; matches
	 * `options.environment`.
	 */
	readonly environment: string;
	/** Operations `diff` would apply during a deploy. */
	readonly ops: ReadonlyArray<Operation>;
	/**
	 * Place keys the prior snapshot records as minted but unpublished (its
	 * `pendingRebuild` marker). A persistent marker is real drift — assets were
	 * provisioned but the place artifact never published — and self-heals on
	 * the next green publish. Empty when nothing owes a publish.
	 */
	readonly pendingRebuild: ReadonlyArray<ResourceKey>;
	/**
	 * One entry per resource flagged redacted in the active environment.
	 * Surfaced so preview output can call out silent noops where the author's
	 * real-value edits stay in config but never reach Open Cloud.
	 */
	readonly redactions: ReadonlyArray<RedactionAnnotation>;
}

interface ResolvedDependencies {
	readonly config: ResolvedConfig;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly redactions: ReadonlyArray<RedactionAnnotation>;
	readonly statePort: StatePort;
}

/**
 * Compute the operations `deploy` would apply for a target environment
 * without writing state. Default-constructs missing deps from the project
 * config and `BEDROCK_GITHUB_TOKEN`; never reads `process.env` when `statePort`
 * and `config` are both supplied explicitly.
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

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}

function getEnvironmentOf(options: PreviewDiffOptions): (name: string) => string | undefined {
	return options.getEnv ?? readProcessEnvironment;
}

function pickStatePort(
	options: PreviewDiffOptions,
	{ config, plugins }: { readonly config: ResolvedConfig; readonly plugins: PluginRegistry },
): Result<StatePort, PreviewDiffError> {
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
		plugins,
		stateConfig: stateConfig.data,
	});
}

function resolveEnvironmentView(
	config: Config,
	environment: string,
): Result<
	{ readonly effective: ResolvedConfig; readonly redactions: ReadonlyArray<RedactionAnnotation> },
	PreviewDiffError
> {
	const merged = selectMergedEnvironment(config, environment);
	if (!merged.success) {
		return { err: merged.err, success: false };
	}

	const selected = selectEnvironment(config, environment);
	if (!selected.success) {
		return { err: selected.err, success: false };
	}

	const environmentResource = extractResourceRedaction(merged.data.entry);
	return {
		data: {
			effective: selected.data,
			redactions: collectRedactionAnnotations(merged.data.merged, environmentResource),
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

	const view = resolveEnvironmentView(config.data.config, options.environment);
	if (!view.success) {
		return view;
	}

	const { effective, redactions } = view.data;
	const readFile = options.readFile ?? nodeReadFile;
	const statePort = pickStatePort(options, {
		config: effective,
		plugins: config.data.plugins,
	});
	if (!statePort.success) {
		return statePort;
	}

	return {
		data: { config: effective, readFile, redactions, statePort: statePort.data },
		success: true,
	};
}

async function runPreviewAsync(
	environment: string,
	dependencies: ResolvedDependencies,
): Promise<Result<DiffPreview, PreviewDiffError>> {
	const desired = await buildDesired({
		readFile: dependencies.readFile,
		resources: flattenConfig(dependencies.config),
	});
	if (!desired.success) {
		return { err: { cause: desired.err, kind: "buildDesiredFailed" }, success: false };
	}

	const prior = await dependencies.statePort.read(environment);
	if (!prior.success) {
		return { err: { cause: prior.err, kind: "stateReadFailed" }, success: false };
	}

	const priorResources = prior.data.state?.resources ?? [];
	const validated = assertAllReconcilable(desired.data, priorResources);
	if (!validated.success) {
		return { err: { cause: validated.err, kind: "buildDesiredFailed" }, success: false };
	}

	return {
		data: {
			environment,
			ops: diff(desired.data, priorResources),
			pendingRebuild: [...(prior.data.state?.pendingRebuild ?? [])],
			redactions: dependencies.redactions,
		},
		success: true,
	};
}
