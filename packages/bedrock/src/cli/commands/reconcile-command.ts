import type { Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import { createClackProgressAdapter } from "../../adapters/clack-progress-adapter.ts";
import type { PluginRegistry } from "../../core/plugin-registry.ts";
import type { Config } from "../../core/schema.ts";
import type { BedrockState } from "../../core/state.ts";
import type { ProgressPort } from "../../ports/progress-port.ts";
import type { BuildStep, DeployError } from "../../shell/deploy.ts";
import {
	loadProjectAsync as defaultLoadProject,
	type LoadConfigOptions,
	type LoadedProject,
} from "../../shell/load-config.ts";
import { buildOverrideInvocation } from "../build-override-invocation.ts";
import { createClackPort } from "../clack-port.ts";
import { buildCredentialOverrides } from "../credential-environment-overrides.ts";
import { createDefaultSpawner } from "../default-spawner.ts";
import { discoverOverride as defaultDiscoverOverride } from "../discover-override.ts";
import { dispatchOverride, type SpawnOverrideError } from "../dispatch-override.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import { nodeMkdirAsync, nodeWriteTextFileAsync } from "../fs-seams.ts";
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
import { dumpUnsavedStateAsync } from "./dump-unsaved-state.ts";

/**
 * Static identity of a reconcile command: the subcommand name (used for
 * override discovery and the `bedrock <name>` / `<name> failed|succeeded`
 * labels) and a resolver that picks the pipeline from the injected deps.
 */
export interface ReconcileCommandSpec {
	/** Subcommand name, used for override discovery and the clack labels. */
	readonly command: string;
	/**
	 * When `true`, the command's pipeline is the fused deploy: on the shell
	 * (non-override) path a `.bedrock/build.ts` override is also discovered
	 * and, when present, injected as the pipeline's `build` step so the deploy
	 * spawns it between its provision and publish stages.
	 */
	readonly fusedBuild?: boolean;
	/** Picks the reconcile pipeline from the injected deps. */
	readonly resolveRun: (deps: ProgDeps) => ReconcileRun;
}

/**
 * A reconcile pipeline invoked once per `--env`. `deploy`, `provision`, and
 * `publish` each supply one; the command scaffolding (parse, load, override
 * discovery, per-env dispatch, exit-code aggregation) is identical around it.
 */
type ReconcileRun = (options: {
	readonly build?: BuildStep;
	readonly config: Config;
	readonly environment: string;
	readonly getEnv: (name: string) => string | undefined;
	readonly plugins: PluginRegistry;
	readonly progress: ProgressPort;
}) => Promise<Result<BedrockState, DeployError>>;

interface Resolved {
	readonly clack: ClackPort;
	readonly command: string;
	readonly discoverOverride: typeof defaultDiscoverOverride;
	readonly exit: (code: number) => void;
	readonly fusedBuild: boolean;
	readonly loadProject: typeof defaultLoadProject;
	readonly mkdir: (path: string) => Promise<void>;
	readonly progressOverride: ProgressPort | undefined;
	readonly projectRoot: string;
	readonly run: ReconcileRun;
	readonly spawner: Spawner;
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

interface DispatchInputs {
	readonly buildOverridePath: string | undefined;
	readonly config: Config;
	readonly getEnv: (name: string) => string | undefined;
	readonly overridePath: string | undefined;
	readonly parsed: CommonOptions;
	readonly plugins: PluginRegistry;
	readonly progress: ProgressPort;
	readonly resolved: Resolved;
}

interface DispatchAndReportInput {
	readonly buildOverridePath: string | undefined;
	readonly loaded: LoadedProject;
	readonly overridePath: string | undefined;
	readonly parsed: CommonOptions;
	readonly resolved: Resolved;
}

interface SpawnBuildStepInputs {
	readonly overridePath: string;
	readonly parsed: CommonOptions;
	readonly spawner: Spawner;
}

/** One environment's failed pipeline run. */
interface RunFailure {
	readonly environment: string;
	readonly err: DeployError;
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
		const code = await runAsync(rawOptions, resolved);
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
		fusedBuild: spec.fusedBuild ?? false,
		loadProject: deps.loadProject ?? defaultLoadProject,
		mkdir: deps.mkdir ?? nodeMkdirAsync,
		progressOverride: deps.progress,
		projectRoot: deps.projectRoot ?? process.cwd(),
		run: spec.resolveRun(deps),
		spawner: deps.spawner ?? createDefaultSpawner(),
		writeFile: deps.writeFile ?? nodeWriteTextFileAsync,
	};
}

function loadOptionsFor(parsed: CommonOptions): LoadConfigOptions | undefined {
	return parsed.configFile === undefined ? undefined : { configFile: parsed.configFile };
}

function cancelAsFailed(resolved: Resolved): void {
	resolved.clack.cancel(`${resolved.command} failed`);
}

function describeBuildSpawnFailure(err: SpawnOverrideError): string {
	// A launch failure omits its cause message here and hands the cause Error
	// to the throw below, so the reason renders once through the shared
	// cause-chain walk rather than being flattened twice.
	return err.kind === "nonZeroExit"
		? `.bedrock/build.ts exited with code ${String(err.exitCode)}`
		: "failed to launch .bedrock/build.ts";
}

function createSpawnBuildStep({ overridePath, parsed, spawner }: SpawnBuildStepInputs): BuildStep {
	return async ({ environment }) => {
		const invocation = buildOverrideInvocation({ environment, overridePath, parsed });
		const result = await dispatchOverride(invocation, spawner);
		if (!result.success) {
			const { err } = result;
			throw new Error(describeBuildSpawnFailure(err), {
				cause: err.kind === "launchFailed" ? err.cause : undefined,
			});
		}
	};
}

function resolveBuildStep({
	buildOverridePath,
	parsed,
	resolved,
}: DispatchInputs): BuildStep | undefined {
	if (buildOverridePath === undefined) {
		return undefined;
	}

	return createSpawnBuildStep({
		overridePath: buildOverridePath,
		parsed,
		spawner: resolved.spawner,
	});
}

/**
 * Follow up a failed pipeline run with whatever recovery its failure mode
 * affords. A refused **State** write is the one failure that leaves work
 * done upstream and unrecorded, so the record it could not persist is
 * dumped locally; every other failure has already been rendered by the
 * progress port.
 *
 * @param resolved - The command's resolved dependency slots.
 * @param failure - The environment whose run failed and the failure it
 *   returned.
 */
async function reportRunFailureAsync(
	resolved: Resolved,
	{ environment, err }: RunFailure,
): Promise<void> {
	if (err.kind !== "stateWriteFailed") {
		return;
	}

	await dumpUnsavedStateAsync(
		{
			clack: resolved.clack,
			mkdir: resolved.mkdir,
			projectRoot: resolved.projectRoot,
			writeFile: resolved.writeFile,
		},
		{ environment, err },
	);
}

async function dispatchEnvironmentsAsync(inputs: DispatchInputs): Promise<ReadonlyArray<string>> {
	const { config, getEnv, overridePath, parsed, plugins, progress, resolved } = inputs;
	const build = resolveBuildStep(inputs);
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

		const result = await resolved.run({
			...(build === undefined ? {} : { build }),
			config,
			environment,
			getEnv,
			plugins,
			progress,
		});
		if (!result.success) {
			await reportRunFailureAsync(resolved, { environment, err: result.err });
			failed.push(environment);
		}
	}

	return failed;
}

function buildGetEnvironment(parsed: CommonOptions): (name: string) => string | undefined {
	const overrides = buildCredentialOverrides(parsed);
	return (name) => overrides[name] ?? process.env[name];
}

async function dispatchAndReportAsync({
	buildOverridePath,
	loaded,
	overridePath,
	parsed,
	resolved,
}: DispatchAndReportInput): Promise<number> {
	const progress: ProgressPort =
		resolved.progressOverride ??
		createClackProgressAdapter({ clack: resolved.clack, config: loaded.config });

	const failures = await dispatchEnvironmentsAsync({
		buildOverridePath,
		config: loaded.config,
		getEnv: buildGetEnvironment(parsed),
		overridePath,
		parsed,
		plugins: loaded.plugins,
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

function discoverOverridePath(resolved: Resolved, command: string): OverrideDiscovery {
	try {
		return {
			kind: "discovered",
			overridePath: resolved.discoverOverride(resolved.projectRoot, command),
		};
	} catch (err) {
		renderOverrideDiscoveryError(err, resolved.clack);
		cancelAsFailed(resolved);
		return { kind: "failed" };
	}
}

function discoverBuildOverridePath(
	resolved: Resolved,
	commandOverridePath: string | undefined,
): OverrideDiscovery {
	// The build override matters only on the shell path of a fused command: a
	// dispatched `.bedrock/<command>.ts` override owns its whole pipeline, and a
	// non-fused command never builds.
	if (commandOverridePath !== undefined || !resolved.fusedBuild) {
		return { kind: "discovered", overridePath: undefined };
	}

	return discoverOverridePath(resolved, "build");
}

async function runAsync(rawOptions: Record<string, unknown>, resolved: Resolved): Promise<number> {
	resolved.clack.intro(`bedrock ${resolved.command}`);

	const parsed = parseCommonOptions(rawOptions);
	if (!parsed.success) {
		renderParseError(parsed.err, resolved.clack);
		cancelAsFailed(resolved);
		return EXIT_ERROR;
	}

	const loaded = await resolved.loadProject(loadOptionsFor(parsed.data));
	if (!loaded.success) {
		renderDeployError({ cause: loaded.err, kind: "configLoadFailed" }, resolved.clack);
		cancelAsFailed(resolved);
		return EXIT_ERROR;
	}

	const discovery = discoverOverridePath(resolved, resolved.command);
	if (discovery.kind === "failed") {
		return EXIT_ERROR;
	}

	const buildDiscovery = discoverBuildOverridePath(resolved, discovery.overridePath);
	if (buildDiscovery.kind === "failed") {
		return EXIT_ERROR;
	}

	return dispatchAndReportAsync({
		buildOverridePath: buildDiscovery.overridePath,
		loaded: loaded.data,
		overridePath: discovery.overridePath,
		parsed: parsed.data,
		resolved,
	});
}
