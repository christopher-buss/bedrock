import process from "node:process";

import { createClackProgressAdapter } from "../../adapters/clack-progress-adapter.ts";
import type { Config } from "../../core/schema.ts";
import type { ProgressPort } from "../../ports/progress-port.ts";
import { deploy as defaultDeploy } from "../../shell/deploy.ts";
import {
	loadConfig as defaultLoadConfig,
	type LoadConfigOptions,
} from "../../shell/load-config.ts";
import { createClackPort } from "../clack-port.ts";
import { buildCredentialOverrides } from "../credential-environment-overrides.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps } from "../index.ts";
import { type CommonOptions, parseCommonOptions } from "../parse-options.ts";
import { type ClackPort, renderDeployError, renderParseError } from "../render.ts";

interface ResolvedDeploy {
	readonly clack: ClackPort;
	readonly deploy: typeof defaultDeploy;
	readonly exit: (code: number) => void;
	readonly loadConfig: typeof defaultLoadConfig;
	readonly progressOverride: ProgressPort | undefined;
}

interface DispatchInputs {
	readonly config: Config;
	readonly environments: ReadonlyArray<string>;
	readonly getEnv: (name: string) => string | undefined;
	readonly progress: ProgressPort;
	readonly resolved: ResolvedDeploy;
}

interface DispatchAndReportInput {
	readonly loaded: Config;
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
		exit: deps.exit ?? ((code: number) => process.exit(code)),
		loadConfig: deps.loadConfig ?? defaultLoadConfig,
		progressOverride: deps.progress,
	};
}

function loadOptionsFor(parsed: CommonOptions): LoadConfigOptions | undefined {
	return parsed.configFile === undefined ? undefined : { configFile: parsed.configFile };
}

function cancelAsFailed(clack: ClackPort): void {
	clack.cancel("deploy failed");
}

async function dispatchEnvironments(inputs: DispatchInputs): Promise<ReadonlyArray<string>> {
	const { config, environments, getEnv, progress, resolved } = inputs;
	const failed: Array<string> = [];
	for (const environment of environments) {
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
	const { loaded, parsed, resolved } = input;
	const progress: ProgressPort =
		resolved.progressOverride ??
		createClackProgressAdapter({ clack: resolved.clack, config: loaded });

	const failures = await dispatchEnvironments({
		config: loaded,
		environments: parsed.environments,
		getEnv: buildGetEnvironment(parsed),
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

	return dispatchAndReport({ loaded: loaded.data, parsed: parsed.data, resolved });
}
