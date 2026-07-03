import type { Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import { createClackProgressAdapter } from "../../adapters/clack-progress-adapter.ts";
import type { Config } from "../../core/schema.ts";
import type { BedrockState } from "../../core/state.ts";
import type { ProgressPort } from "../../ports/progress-port.ts";
import type { DeployError } from "../../shell/deploy.ts";
import {
	loadConfig as defaultLoadConfig,
	type LoadConfigOptions,
} from "../../shell/load-config.ts";
import { buildOverrideInvocation } from "../build-override-invocation.ts";
import { createClackPort } from "../clack-port.ts";
import { buildCredentialOverrides } from "../credential-environment-overrides.ts";
import { createDefaultSpawner } from "../default-spawner.ts";
import { discoverOverride as defaultDiscoverOverride } from "../discover-override.ts";
import { dispatchOverride } from "../dispatch-override.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps } from "../index.ts";
import { type CommonOptions, parseCommonOptions } from "../parse-options.ts";
import {
	type ClackPort,
	renderDeployError,
	renderOverrideDiscoveryError,
	renderOverrideError,
	renderParseError,
} from "../render.ts";
import type { Spawner } from "../spawner.ts";

/**
 * Static identity of a reconcile command: the subcommand name (used for
 * override discovery and the `bedrock <name>` / `<name> failed|succeeded`
 * labels) and a resolver that picks the pipeline from the injected deps.
 */
export interface ReconcileCommandSpec {
	/** Subcommand name, used for override discovery and the clack labels. */
	readonly command: string;
	/** Picks the reconcile pipeline from the injected deps. */
	readonly resolveRun: (deps: ProgDeps) => ReconcileRun;
}

/**
 * A reconcile pipeline invoked once per `--env`. `deploy`, `provision`, and
 * `publish` each supply one; the command scaffolding (parse, load, override
 * discovery, per-env dispatch, exit-code aggregation) is identical around it.
 */
type ReconcileRun = (options: {
	readonly config: Config;
	readonly environment: string;
	readonly getEnv: (name: string) => string | undefined;
	readonly progress: ProgressPort;
}) => Promise<Result<BedrockState, DeployError>>;

interface Resolved {
	readonly clack: ClackPort;
	readonly command: string;
	readonly discoverOverride: typeof defaultDiscoverOverride;
	readonly exit: (code: number) => void;
	readonly loadConfig: typeof defaultLoadConfig;
	readonly progressOverride: ProgressPort | undefined;
	readonly projectRoot: string;
	readonly run: ReconcileRun;
	readonly spawner: Spawner;
}

interface DispatchInputs {
	readonly config: Config;
	readonly getEnv: (name: string) => string | undefined;
	readonly overridePath: string | undefined;
	readonly parsed: CommonOptions;
	readonly progress: ProgressPort;
	readonly resolved: Resolved;
}

interface DispatchAndReportInput {
	readonly loaded: Config;
	readonly overridePath: string | undefined;
	readonly parsed: CommonOptions;
	readonly resolved: Resolved;
}

type OverrideDiscovery =
	| { readonly kind: "discovered"; readonly overridePath: string | undefined }
	| { readonly kind: "failed" };

/**
 * Build the sade action for a reconcile subcommand. The returned function
 * parses the raw options via `parseCommonOptions`, loads the project config
 * once, discovers a `.bedrock/<command>.ts` override, and dispatches the
 * pipeline (or the override spawn) for each `--env` value in order. The
 * aggregated exit code is `EXIT_OK` only when every env succeeded.
 * @param deps - Dependency overrides; missing slots are default-constructed.
 * @param spec - The subcommand's name and pipeline resolver.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function createReconcileCommand(
	deps: ProgDeps,
	spec: ReconcileCommandSpec,
): (rawOptions: Record<string, unknown>) => Promise<void> {
	const resolved = resolveDeps(deps, spec);
	return async (rawOptions) => {
		const code = await run(rawOptions, resolved);
		resolved.exit(code);
	};
}

function resolveDeps(deps: ProgDeps, spec: ReconcileCommandSpec): Resolved {
	const clack = deps.clack ?? createClackPort();
	return {
		clack,
		command: spec.command,
		discoverOverride: deps.discoverOverride ?? defaultDiscoverOverride,
		exit: deps.exit ?? ((code: number) => process.exit(code)),
		loadConfig: deps.loadConfig ?? defaultLoadConfig,
		progressOverride: deps.progress,
		projectRoot: deps.projectRoot ?? process.cwd(),
		run: spec.resolveRun(deps),
		spawner: deps.spawner ?? createDefaultSpawner(),
	};
}

function loadOptionsFor(parsed: CommonOptions): LoadConfigOptions | undefined {
	return parsed.configFile === undefined ? undefined : { configFile: parsed.configFile };
}

function cancelAsFailed(resolved: Resolved): void {
	resolved.clack.cancel(`${resolved.command} failed`);
}

async function dispatchEnvironments(inputs: DispatchInputs): Promise<ReadonlyArray<string>> {
	const { config, getEnv, overridePath, parsed, progress, resolved } = inputs;
	const failed: Array<string> = [];
	for (const environment of parsed.environments) {
		if (overridePath !== undefined) {
			const invocation = buildOverrideInvocation({ environment, overridePath, parsed });
			const result = await dispatchOverride(invocation, resolved.spawner);
			if (!result.success) {
				renderOverrideError({ environment, err: result.err }, resolved.clack);
				failed.push(environment);
			}

			continue;
		}

		const result = await resolved.run({ config, environment, getEnv, progress });
		if (!result.success) {
			failed.push(environment);
		}
	}

	return failed;
}

function buildGetEnvironment(parsed: CommonOptions): (name: string) => string | undefined {
	const overrides = buildCredentialOverrides(parsed);
	return (name) => overrides[name] ?? process.env[name];
}

async function dispatchAndReport(input: DispatchAndReportInput): Promise<number> {
	const { loaded, overridePath, parsed, resolved } = input;
	const progress: ProgressPort =
		resolved.progressOverride ??
		createClackProgressAdapter({ clack: resolved.clack, config: loaded });

	const failures = await dispatchEnvironments({
		config: loaded,
		getEnv: buildGetEnvironment(parsed),
		overridePath,
		parsed,
		progress,
		resolved,
	});
	if (failures.length > 0) {
		cancelAsFailed(resolved);
		return EXIT_ERROR;
	}

	resolved.clack.outro(`${resolved.command} succeeded`);
	return EXIT_OK;
}

function discoverOverridePath(resolved: Resolved): OverrideDiscovery {
	try {
		return {
			kind: "discovered",
			overridePath: resolved.discoverOverride(resolved.projectRoot, resolved.command),
		};
	} catch (err) {
		renderOverrideDiscoveryError(err, resolved.clack);
		cancelAsFailed(resolved);
		return { kind: "failed" };
	}
}

async function run(rawOptions: Record<string, unknown>, resolved: Resolved): Promise<number> {
	resolved.clack.intro(`bedrock ${resolved.command}`);

	const parsed = parseCommonOptions(rawOptions);
	if (!parsed.success) {
		renderParseError(parsed.err, resolved.clack);
		cancelAsFailed(resolved);
		return EXIT_ERROR;
	}

	const loaded = await resolved.loadConfig(loadOptionsFor(parsed.data));
	if (!loaded.success) {
		renderDeployError({ cause: loaded.err, kind: "configLoadFailed" }, resolved.clack);
		cancelAsFailed(resolved);
		return EXIT_ERROR;
	}

	const discovery = discoverOverridePath(resolved);
	if (discovery.kind === "failed") {
		return EXIT_ERROR;
	}

	return dispatchAndReport({
		loaded: loaded.data,
		overridePath: discovery.overridePath,
		parsed: parsed.data,
		resolved,
	});
}
