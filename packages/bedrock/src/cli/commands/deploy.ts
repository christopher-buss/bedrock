import process from "node:process";

import type { Config } from "../../core/schema.ts";
import { deploy as defaultDeploy } from "../../shell/deploy.ts";
import {
	loadConfig as defaultLoadConfig,
	type LoadConfigOptions,
} from "../../shell/load-config.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps } from "../index.ts";
import { type CommonOptions, parseCommonOptions } from "../parse-options.ts";
import { type ClackPort, createClackPort, renderDeployError, renderParseError } from "../render.ts";

const DEPLOY_FAILED_MESSAGE = "deploy failed";

interface ResolvedDeploy {
	readonly clack: ClackPort;
	readonly deploy: typeof defaultDeploy;
	readonly exit: (code: number) => never;
	readonly loadConfig: typeof defaultLoadConfig;
}

interface DispatchInputs {
	readonly config: Config;
	readonly environments: ReadonlyArray<string>;
	readonly getEnv: (name: string) => string | undefined;
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
	return {
		clack: deps.clack ?? createClackPort(),
		deploy: deps.deploy ?? defaultDeploy,
		exit: deps.exit ?? ((code: number) => process.exit(code)),
		loadConfig: deps.loadConfig ?? defaultLoadConfig,
	};
}

function loadOptionsFor(parsed: CommonOptions): LoadConfigOptions | undefined {
	return parsed.configFile === undefined ? undefined : { configFile: parsed.configFile };
}

async function dispatchEnvironments(inputs: DispatchInputs): Promise<ReadonlyArray<string>> {
	const { config, environments, getEnv, resolved } = inputs;
	const failed: Array<string> = [];
	for (const environment of environments) {
		const result = await resolved.deploy({
			config,
			environment,
			getEnv,
		});
		if (result.success) {
			resolved.clack.logSuccess(
				`${environment}: ${result.data.resources.length} resources reconciled`,
			);
		} else {
			renderDeployError(result.err, resolved.clack);
			failed.push(environment);
		}
	}

	return failed;
}

function buildGetEnvironment(parsed: CommonOptions): (name: string) => string | undefined {
	return (name) => {
		if (name === "ROBLOX_API_KEY" && parsed.apiKey !== undefined) {
			return parsed.apiKey;
		}

		if (name === "GITHUB_TOKEN" && parsed.githubToken !== undefined) {
			return parsed.githubToken;
		}

		return process.env[name];
	};
}

async function runDeploy(
	rawOptions: Record<string, unknown>,
	resolved: ResolvedDeploy,
): Promise<number> {
	resolved.clack.intro("bedrock deploy");

	const parsed = parseCommonOptions(rawOptions);
	if (!parsed.success) {
		renderParseError(parsed.err, resolved.clack);
		resolved.clack.cancel(DEPLOY_FAILED_MESSAGE);
		return EXIT_ERROR;
	}

	const loaded = await resolved.loadConfig(loadOptionsFor(parsed.data));
	if (!loaded.success) {
		renderDeployError({ cause: loaded.err, kind: "configLoadFailed" }, resolved.clack);
		resolved.clack.cancel(DEPLOY_FAILED_MESSAGE);
		return EXIT_ERROR;
	}

	const failures = await dispatchEnvironments({
		config: loaded.data,
		environments: parsed.data.environments,
		getEnv: buildGetEnvironment(parsed.data),
		resolved,
	});
	if (failures.length > 0) {
		resolved.clack.cancel(DEPLOY_FAILED_MESSAGE);
		return EXIT_ERROR;
	}

	resolved.clack.outro("deploy succeeded");
	return EXIT_OK;
}
