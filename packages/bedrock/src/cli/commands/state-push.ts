import type { Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import type { PluginRegistry } from "../../core/plugin-registry.ts";
import { resolveStateConfig } from "../../core/resolve-state-config.ts";
import type { Config } from "../../core/schema.ts";
import { parseStateContents } from "../../core/state-file.ts";
import type { BedrockState } from "../../core/state.ts";
import type { StatePort } from "../../ports/state-port.ts";
import { buildStatePort as defaultBuildStatePort } from "../../shell/build-state-port.ts";
import {
	loadProjectAsync as defaultLoadProject,
	type LoadedProject,
} from "../../shell/load-config.ts";
import { createClackPort } from "../clack-port.ts";
import { buildEnvironmentReader } from "../credential-environment-overrides.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import { nodeReadTextFileAsync, nodeRemoveFileAsync } from "../fs-seams.ts";
import type { ProgDeps } from "../index.ts";
import type { CommonOptions } from "../parse-options.ts";
import { recoveryFilePath } from "../recovery-file.ts";
import {
	type ClackPort,
	renderBuildStatePortError,
	renderDeployError,
	renderStateWriteError,
} from "../render.ts";
import { describeUnknown } from "./describe-unknown.ts";
import { startCommandAsync } from "./start-command.ts";

const COMMAND = "state push";

/** The command's dependency slots, each resolved to a real default. */
interface ResolvedStatePush {
	readonly buildStatePort: typeof defaultBuildStatePort;
	readonly clack: ClackPort;
	readonly exit: (code: number) => void;
	readonly loadProject: typeof defaultLoadProject;
	readonly projectRoot: string;
	readonly readTextFile: (path: string) => Promise<string>;
	readonly removeFile: (path: string) => Promise<void>;
}

/** Every environment's push, over the project the command loaded once. */
interface PushEnvironmentsInputs {
	readonly loaded: LoadedProject;
	readonly parsed: CommonOptions;
	readonly resolved: ResolvedStatePush;
}

/** One environment's push, over the project the command loaded once. */
interface PushInputs {
	readonly config: Config;
	readonly environment: string;
	readonly getEnvironment: (name: string) => string | undefined;
	readonly plugins: PluginRegistry;
	readonly resolved: ResolvedStatePush;
}

/**
 * Build the sade action for `bedrock state push`. Pushes the **State** a
 * failed write dumped locally to the **Backend** configured for each
 * `--env`, so a deploy that applied upstream but could not record what it
 * did is recoverable without hand-editing.
 *
 * Every failure is reported against the environment it belongs to and the
 * remaining environments still run; the aggregated exit code is `EXIT_OK`
 * only when every environment pushed.
 *
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function statePushCommand(
	deps: ProgDeps,
): (rawOptions: Readonly<Record<string, unknown>>) => Promise<void> {
	const resolved = resolveStatePush(deps);
	return async (rawOptions) => {
		const code = await runAsync(rawOptions, resolved);
		resolved.exit(code);
	};
}

function resolveStatePush(deps: ProgDeps): ResolvedStatePush {
	return {
		buildStatePort: deps.buildStatePort ?? defaultBuildStatePort,
		clack: deps.clack ?? createClackPort(),
		exit: deps.exit ?? ((code: number) => process.exit(code)),
		loadProject: deps.loadProject ?? defaultLoadProject,
		projectRoot: deps.projectRoot ?? process.cwd(),
		readTextFile: deps.readTextFile ?? nodeReadTextFileAsync,
		removeFile: deps.removeFile ?? nodeRemoveFileAsync,
	};
}

/**
 * Read and validate the dump for one environment. A dump recorded for a
 * different environment is refused rather than pushed: the file names the
 * environment it belongs to, and pushing it elsewhere would overwrite that
 * environment's record with a foreign one.
 *
 * @param inputs - The environment being pushed and the resolved deps.
 * @param filePath - Path of the dump to read.
 * @returns The dumped state, or `Err` once the reason has been rendered.
 */
async function readDumpAsync(
	{ environment, resolved }: PushInputs,
	filePath: string,
): Promise<Result<BedrockState, void>> {
	let raw: string;
	try {
		raw = await resolved.readTextFile(filePath);
	} catch (err) {
		resolved.clack.logError(
			`cannot read the unsaved state at ${filePath}: ${describeUnknown(err)}`,
		);
		return { err: undefined, success: false };
	}

	const parsed = parseStateContents(raw, filePath);
	if (!parsed.success) {
		renderDeployError({ cause: parsed.err, kind: "stateReadFailed" }, resolved.clack);
		return { err: undefined, success: false };
	}

	if (parsed.data.environment !== environment) {
		resolved.clack.logError(
			`${filePath} holds state for '${parsed.data.environment}', not '${environment}'`,
		);
		return { err: undefined, success: false };
	}

	return { data: parsed.data, success: true };
}

function describePushed(state: BedrockState, filePath: string): string {
	const count = state.resources.length;
	const noun = count === 1 ? "resource" : "resources";
	return `${state.environment}: ${String(count)} ${noun} pushed from ${filePath}, which has been removed`;
}

/**
 * Consume the dump that was just pushed. A dump left on disk outlives the
 * failure it recorded, and pushing it again after a later deploy would
 * revert that deploy's record, so removal is part of the push rather than
 * housekeeping. A removal that fails leaves the push standing and says what
 * is still there.
 *
 * @param resolved - The command's resolved dependency slots.
 * @param filePath - The dump that was pushed.
 * @returns Whether the dump is gone.
 */
async function consumeDumpAsync(resolved: ResolvedStatePush, filePath: string): Promise<boolean> {
	try {
		await resolved.removeFile(filePath);
		return true;
	} catch (err) {
		resolved.clack.logMessage(
			`${filePath} could not be removed (${describeUnknown(err)}). Delete it, so a later push cannot revert this state.`,
		);
		return false;
	}
}

/**
 * Push one environment's dump, reporting whichever step refused.
 *
 * @param inputs - The environment being pushed and the loaded project.
 * @returns Whether the environment's state reached the **Backend**.
 */
/**
 * Build the **Backend** this environment's state belongs in, reporting an
 * environment with no state block or a backend that refused to build.
 *
 * @param inputs - The environment being pushed and the loaded project.
 * @returns The port to write through, or `Err` once the reason has been
 * rendered.
 */
function resolveStatePortFor({
	config,
	environment,
	getEnvironment,
	plugins,
	resolved,
}: PushInputs): Result<StatePort, void> {
	const stateConfig = resolveStateConfig(config, environment);
	if (!stateConfig.success) {
		renderDeployError(stateConfig.err, resolved.clack);
		return { err: undefined, success: false };
	}

	const port = resolved.buildStatePort({
		getEnv: getEnvironment,
		plugins,
		stateConfig: stateConfig.data,
	});
	if (port.success) {
		return port;
	}

	renderBuildStatePortError(port.err, resolved.clack);
	return { err: undefined, success: false };
}

async function pushEnvironmentAsync(inputs: PushInputs): Promise<boolean> {
	const { environment, resolved } = inputs;
	const filePath = recoveryFilePath(resolved.projectRoot, environment);
	const dumped = await readDumpAsync(inputs, filePath);
	if (!dumped.success) {
		return false;
	}

	const port = resolveStatePortFor(inputs);
	if (!port.success) {
		return false;
	}

	const written = await port.data.write(dumped.data);
	if (!written.success) {
		renderStateWriteError({ environment, err: written.err }, resolved.clack);
		return false;
	}

	const consumed = await consumeDumpAsync(resolved, filePath);
	if (consumed) {
		resolved.clack.logSuccess(describePushed(dumped.data, filePath));
	}

	return true;
}

/**
 * Push every requested environment in order, so one environment's refusal
 * does not strand the dumps of the others.
 *
 * @param inputs - The validated flags, the loaded project, and the resolved
 *   dependency slots.
 * @returns Whether every environment pushed.
 */
async function pushEnvironmentsAsync({
	loaded,
	parsed,
	resolved,
}: PushEnvironmentsInputs): Promise<boolean> {
	const getEnvironment = buildEnvironmentReader(parsed);
	let pushed = true;
	for (const environment of parsed.environments) {
		const ok = await pushEnvironmentAsync({
			config: loaded.config,
			environment,
			getEnvironment,
			plugins: loaded.plugins,
			resolved,
		});
		pushed &&= ok;
	}

	return pushed;
}

async function runAsync(
	rawOptions: Readonly<Record<string, unknown>>,
	resolved: ResolvedStatePush,
): Promise<number> {
	const started = await startCommandAsync(
		{ clack: resolved.clack, command: COMMAND, loadProject: resolved.loadProject },
		rawOptions,
	);
	if (!started.success) {
		return EXIT_ERROR;
	}

	const pushed = await pushEnvironmentsAsync({ ...started.data, resolved });
	if (!pushed) {
		resolved.clack.cancel(`${COMMAND} failed`);
		return EXIT_ERROR;
	}

	resolved.clack.outro(`${COMMAND} succeeded`);
	return EXIT_OK;
}
