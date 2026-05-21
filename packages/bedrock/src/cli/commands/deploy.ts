import process from "node:process";

import { createClackProgressAdapter } from "../../adapters/clack-progress-adapter.ts";
import type { Config } from "../../core/schema.ts";
import type { ProgressPort } from "../../ports/progress-port.ts";
import { deploy as defaultDeploy } from "../../shell/deploy.ts";
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
	renderOverrideError,
	renderParseError,
} from "../render.ts";
import type { Spawner } from "../spawner.ts";

interface ResolvedDeploy {
	readonly clack: ClackPort;
	readonly deploy: typeof defaultDeploy;
	readonly discoverOverride: typeof defaultDiscoverOverride;
	readonly exit: (code: number) => void;
	readonly loadConfig: typeof defaultLoadConfig;
	readonly progressOverride: ProgressPort | undefined;
	readonly projectRoot: string;
	readonly spawner: Spawner;
}

interface DispatchInputs {
	readonly config: Config;
	readonly getEnv: (name: string) => string | undefined;
	readonly overridePath: string | undefined;
	readonly parsed: CommonOptions;
	readonly progress: ProgressPort;
	readonly resolved: ResolvedDeploy;
}

interface DispatchAndReportInput {
	readonly loaded: Config;
	readonly overridePath: string | undefined;
	readonly parsed: CommonOptions;
	readonly resolved: ResolvedDeploy;
}

/**
 * Build the sade action for `bedrock deploy`. The returned function consumes
 * the raw options object sade hands the action callback, parses it via
 * `parseCommonOptions`, loads the project config once, and dispatches
 * `deploy()` for each `--env` value in order. Per-env successes and failures
 * render through clack as a single line each; the aggregated exit code is
 * `EXIT_OK` only when every env succeeded.
 *
 * When a `.bedrock/deploy.ts` override is discovered under the resolved
 * project root, each `--env` is handed to the spawner via
 * {@link dispatchOverride} instead of the in-process `deploy()` call. The
 * aggregation rule is identical: every env still runs, and the exit code
 * is `EXIT_OK` only when every spawn returned a zero exit code.
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function deployCommand(
	deps: ProgDeps,
): (rawOptions: Record<string, unknown>) => Promise<void> {
	const resolved = resolveDeploy(deps);
	return async (rawOptions) => {
		const code = await runDeploy(rawOptions, resolved);
		resolved.exit(code);
	};
}

function resolveDeploy(deps: ProgDeps): ResolvedDeploy {
	const clack = deps.clack ?? createClackPort();
	return {
		clack,
		deploy: deps.deploy ?? defaultDeploy,
		discoverOverride: deps.discoverOverride ?? defaultDiscoverOverride,
		exit: deps.exit ?? ((code: number) => process.exit(code)),
		loadConfig: deps.loadConfig ?? defaultLoadConfig,
		progressOverride: deps.progress,
		projectRoot: deps.projectRoot ?? process.cwd(),
		spawner: deps.spawner ?? createDefaultSpawner(),
	};
}

function loadOptionsFor(parsed: CommonOptions): LoadConfigOptions | undefined {
	return parsed.configFile === undefined ? undefined : { configFile: parsed.configFile };
}

function cancelAsFailed(clack: ClackPort): void {
	clack.cancel("deploy failed");
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

		const result = await resolved.deploy({
			config,
			environment,
			getEnv,
			progress,
		});
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
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	resolved.clack.outro("deploy succeeded");
	return EXIT_OK;
}

async function runDeploy(
	rawOptions: Record<string, unknown>,
	resolved: ResolvedDeploy,
): Promise<number> {
	resolved.clack.intro("bedrock deploy");

	const parsed = parseCommonOptions(rawOptions);
	if (!parsed.success) {
		renderParseError(parsed.err, resolved.clack);
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	const loaded = await resolved.loadConfig(loadOptionsFor(parsed.data));
	if (!loaded.success) {
		renderDeployError({ cause: loaded.err, kind: "configLoadFailed" }, resolved.clack);
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	const overridePath = resolved.discoverOverride(resolved.projectRoot, "deploy");

	return dispatchAndReport({
		loaded: loaded.data,
		overridePath,
		parsed: parsed.data,
		resolved,
	});
}
