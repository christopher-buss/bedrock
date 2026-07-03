import process from "node:process";

import { isCodegenEnabled } from "../../core/codegen.ts";
import {
	loadConfig as defaultLoadConfig,
	type LoadConfigOptions,
} from "../../shell/load-config.ts";
import { buildOverrideInvocation } from "../build-override-invocation.ts";
import { createClackPort } from "../clack-port.ts";
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

// A codegen project embeds generated source into its place artifact, so it
// must supply a build override that produces that artifact. There is no
// built-in default build, so a missing override is a hard error rather than a
// silent skip. Kept here rather than in `render.ts` (which is at its
// max-lines ceiling) because the message is specific to this command.
const MISSING_BUILD_OVERRIDE_MESSAGE =
	"codegen is enabled but no .bedrock/build.ts override was found: add one that writes each place's built artifact to its configured file path, or disable codegen";

interface ResolvedBuild {
	readonly clack: ClackPort;
	readonly discoverOverride: typeof defaultDiscoverOverride;
	readonly exit: (code: number) => void;
	readonly loadConfig: typeof defaultLoadConfig;
	readonly projectRoot: string;
	readonly spawner: Spawner;
}

type OverrideDiscovery =
	| { readonly kind: "discovered"; readonly overridePath: string | undefined }
	| { readonly kind: "failed" };

interface DispatchOverrideInputs {
	readonly overridePath: string;
	readonly parsed: CommonOptions;
	readonly resolved: ResolvedBuild;
}

/**
 * Build the sade action for `bedrock build`. The returned function parses the
 * raw options via `parseCommonOptions`, discovers a `.bedrock/build.ts`
 * override under the resolved project root, and — when one exists — hands each
 * `--env` to the spawner via {@link dispatchOverride}. Producing the place
 * artifact is entirely the override's job; there is no built-in default build.
 * With no override the config decides the outcome: a codegen project owes an
 * artifact it cannot produce, so it is a hard error (`EXIT_ERROR`); a
 * no-codegen project has nothing to produce and exits `EXIT_OK`.
 *
 * The aggregation rule mirrors `deploy`: every env still runs and the exit
 * code is `EXIT_OK` only when every spawn returned a zero exit code. Only
 * failures emit a per-env line; a successful spawn's output comes from the
 * override script's own inherited stdout.
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function buildCommand(
	deps: ProgDeps,
): (rawOptions: Record<string, unknown>) => Promise<void> {
	const resolved = resolveBuild(deps);
	return async (rawOptions) => {
		const code = await runBuild(rawOptions, resolved);
		resolved.exit(code);
	};
}

function resolveBuild(deps: ProgDeps): ResolvedBuild {
	return {
		clack: deps.clack ?? createClackPort(),
		discoverOverride: deps.discoverOverride ?? defaultDiscoverOverride,
		exit: deps.exit ?? ((code: number) => process.exit(code)),
		loadConfig: deps.loadConfig ?? defaultLoadConfig,
		projectRoot: deps.projectRoot ?? process.cwd(),
		spawner: deps.spawner ?? createDefaultSpawner(),
	};
}

function cancelAsFailed(clack: ClackPort): void {
	clack.cancel("build failed");
}

function discoverBuildOverride(resolved: ResolvedBuild): OverrideDiscovery {
	try {
		return {
			kind: "discovered",
			overridePath: resolved.discoverOverride(resolved.projectRoot, "build"),
		};
	} catch (err) {
		renderOverrideDiscoveryError(err, resolved.clack);
		cancelAsFailed(resolved.clack);
		return { kind: "failed" };
	}
}

async function dispatchOverrideEnvironments(inputs: DispatchOverrideInputs): Promise<number> {
	const { overridePath, parsed, resolved } = inputs;
	const failed: Array<string> = [];
	for (const environment of parsed.environments) {
		const invocation = buildOverrideInvocation({ environment, overridePath, parsed });
		const result = await dispatchOverride(invocation, resolved.spawner);
		if (!result.success) {
			renderOverrideError({ environment, err: result.err }, resolved.clack);
			failed.push(environment);
		}
	}

	if (failed.length > 0) {
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	resolved.clack.outro("build succeeded");
	return EXIT_OK;
}

function loadOptionsFor(parsed: CommonOptions): LoadConfigOptions | undefined {
	return parsed.configFile === undefined ? undefined : { configFile: parsed.configFile };
}

async function reportNoOverride(parsed: CommonOptions, resolved: ResolvedBuild): Promise<number> {
	const loaded = await resolved.loadConfig(loadOptionsFor(parsed));
	if (!loaded.success) {
		renderDeployError({ cause: loaded.err, kind: "configLoadFailed" }, resolved.clack);
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	if (isCodegenEnabled(loaded.data.codegen)) {
		resolved.clack.logError(MISSING_BUILD_OVERRIDE_MESSAGE);
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	resolved.clack.outro("nothing to build");
	return EXIT_OK;
}

async function runBuild(
	rawOptions: Record<string, unknown>,
	resolved: ResolvedBuild,
): Promise<number> {
	resolved.clack.intro("bedrock build");

	const parsed = parseCommonOptions(rawOptions);
	if (!parsed.success) {
		renderParseError(parsed.err, resolved.clack);
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	const discovery = discoverBuildOverride(resolved);
	if (discovery.kind === "failed") {
		return EXIT_ERROR;
	}

	if (discovery.overridePath !== undefined) {
		return dispatchOverrideEnvironments({
			overridePath: discovery.overridePath,
			parsed: parsed.data,
			resolved,
		});
	}

	return reportNoOverride(parsed.data, resolved);
}
