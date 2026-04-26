import type { Result } from "@bedrock/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";
import process from "node:process";

import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { ConfigError } from "../core/config-error.ts";
import { diff } from "../core/diff.ts";
import { flattenConfig } from "../core/flatten.ts";
import type { Operation } from "../core/operations.ts";
import { resolveStateConfig, type StateNotConfiguredError } from "../core/resolve-state-config.ts";
import type { Config, ResolvedConfig } from "../core/schema.ts";
import {
	type IncompletePlaceEntryError,
	selectEnvironment,
	type UnknownEnvironmentError,
} from "../core/select-environment.ts";
import type { StateError } from "../core/state.ts";
import type { StatePort } from "../ports/state-port.ts";
import { buildDesired, type BuildDesiredError } from "./build-desired.ts";
import {
	buildStatePort,
	type MissingCredentialError,
	type UnsupportedBackendError,
} from "./build-state-port.ts";
import { loadConfig as defaultLoadConfig, type LoadConfigOptions } from "./load-config.ts";

/**
 * Inputs for `previewDiff`. Mirrors `DeployOptions` minus the apply-side
 * dependencies (`registry`); every field except `environment` is optional
 * and default-constructed from the project config and the environment
 * variables `GITHUB_TOKEN` (gist state backend) when omitted.
 */
export interface PreviewDiffOptions {
	/** Pre-loaded, optionally-mutated project config. Omit to call `loadConfig()` automatically. */
	readonly config?: Config;
	/** Environment name; threaded into `StatePort.read`. */
	readonly environment: string;
	/** `fetch` override plumbed into the default-constructed gist adapter when `statePort` is omitted. */
	readonly fetch?: GistFetch;
	/** Reads an environment variable; defaults to `(name) => process.env[name]`. */
	readonly getEnv?: (name: string) => string | undefined;
	/** Loader invoked when `config` is omitted; defaults to `loadConfig` from this package. */
	readonly loadConfig?: (options?: LoadConfigOptions) => Promise<Result<Config, ConfigError>>;
	/** Reads file bytes for resources that have file-backed inputs. Defaults to `node:fs/promises.readFile`. */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/** Backend used to read the prior snapshot. Default-constructed from `config.state` and `GITHUB_TOKEN` when omitted. */
	readonly statePort?: StatePort;
}

/**
 * Failure surfaced by `previewDiff`. Stage-tagged so callers can branch on
 * `kind`. Strict subset of `DeployError`: every variant here is also a
 * `DeployError` variant, but the apply-side variants (`applyFailed`,
 * `stateWriteFailed`) cannot occur because `previewDiff` is read-only.
 */
export type PreviewDiffError =
	| IncompletePlaceEntryError
	| MissingCredentialError
	| StateNotConfiguredError
	| UnknownEnvironmentError
	| UnsupportedBackendError
	| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" }
	| { readonly cause: ConfigError; readonly kind: "configLoadFailed" }
	| { readonly cause: StateError; readonly kind: "stateReadFailed" };

/** Successful preview output. */
export interface DiffPreview {
	/** Environment the preview was computed against; matches `options.environment`. */
	readonly environment: string;
	/** Operations `diff` would apply during a deploy. */
	readonly ops: ReadonlyArray<Operation>;
}

interface ResolvedDeps {
	readonly config: ResolvedConfig;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly statePort: StatePort;
}

/**
 * Compute the operations `deploy` would apply for a target environment
 * without writing state. Default-constructs missing deps from the project
 * config and `GITHUB_TOKEN`; never reads `process.env` when `statePort`
 * and `config` are both supplied explicitly.
 *
 * @param options - Target environment plus optional overrides.
 * @returns The computed operations on success, or a stage-tagged
 *   `PreviewDiffError` on failure.
 */
export async function previewDiff(
	options: PreviewDiffOptions,
): Promise<Result<DiffPreview, PreviewDiffError>> {
	const resolved = await resolveDeps(options);
	if (!resolved.success) {
		return resolved;
	}

	return runPreview(options.environment, resolved.data);
}

async function pickConfig(options: PreviewDiffOptions): Promise<Result<Config, PreviewDiffError>> {
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

function getEnvironmentOf(options: PreviewDiffOptions): (name: string) => string | undefined {
	return options.getEnv ?? readProcessEnvironment;
}

function pickStatePort(
	options: PreviewDiffOptions,
	config: ResolvedConfig,
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
		stateConfig: stateConfig.data,
	});
}

async function resolveDeps(
	options: PreviewDiffOptions,
): Promise<Result<ResolvedDeps, PreviewDiffError>> {
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

	return {
		data: {
			config: effective,
			readFile,
			statePort: statePort.data,
		},
		success: true,
	};
}

async function runPreview(
	environment: string,
	deps: ResolvedDeps,
): Promise<Result<DiffPreview, PreviewDiffError>> {
	const desired = await buildDesired(flattenConfig(deps.config), deps.readFile);
	if (!desired.success) {
		return { err: { cause: desired.err, kind: "buildDesiredFailed" }, success: false };
	}

	const prior = await deps.statePort.read(environment);
	if (!prior.success) {
		return { err: { cause: prior.err, kind: "stateReadFailed" }, success: false };
	}

	const priorResources = prior.data?.resources ?? [];
	const ops = diff(desired.data, priorResources);
	return { data: { environment, ops }, success: true };
}
