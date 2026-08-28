import process from "node:process";

import type { StateBackendFetch } from "../../core/plugin.ts";
import type { StateConfig } from "../../core/schema.ts";
import {
	loadProjectAsync as defaultLoadProject,
	type LoadedProject,
} from "../../shell/load-config.ts";
import { moveStateAsync as defaultMoveState } from "../../shell/move-state.ts";
import { createClackPort } from "../clack-port.ts";
import { buildEnvironmentReader } from "../credential-environment-overrides.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { loadOptionsFor } from "../parse-options.ts";
import { parseStateMoveOptions, type StateMoveOptions } from "../parse-state-move-options.ts";
import {
	type ClackPort,
	renderDeployError,
	renderMoveDestinationError,
	renderMoveStateError,
	renderParseError,
	renderStateMoveOutcome,
} from "../render.ts";
import { resolveMoveDestination } from "../state-move-destination.ts";

const COMMAND = "state move";

/** What running the move needs once every input has resolved. */
interface MoveInputs {
	/** The `state` block the flags described. */
	readonly destination: StateConfig;
	/** The validated flags. */
	readonly options: StateMoveOptions;
	/** The validated config and what its `plugins` entries declared. */
	readonly project: LoadedProject;
}

/** The command's dependency slots, each resolved to a real default. */
interface ResolvedStateMove {
	readonly clack: ClackPort;
	readonly exit: (code: number) => void;
	readonly fetch: StateBackendFetch | undefined;
	readonly loadProject: typeof defaultLoadProject;
	readonly moveState: typeof defaultMoveState;
}

/**
 * Build the sade action for `bedrock state move`. Relocates each `--env`'s
 * **State** from the **Backend** the config names onto the one the `--to`
 * flags describe, leaving the source copy where it is.
 *
 * The destination is named entirely in flags, so a move runs the same way
 * with a terminal and without one.
 *
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function stateMoveCommand(
	deps: ProgDependencies,
): (rawOptions: Readonly<Record<string, unknown>>) => Promise<void> {
	const resolved = resolveStateMove(deps);
	return async (rawOptions) => {
		const code = await runAsync(rawOptions, resolved);
		resolved.exit(code);
	};
}

function resolveStateMove(deps: ProgDependencies): ResolvedStateMove {
	return {
		clack: deps.clack ?? createClackPort(),
		exit: deps.exit ?? ((code: number) => process.exit(code)),
		fetch: deps.fetch,
		loadProject: deps.loadProject ?? defaultLoadProject,
		moveState: deps.moveState ?? defaultMoveState,
	};
}

function failed(resolved: ResolvedStateMove): number {
	resolved.clack.cancel(`${COMMAND} failed`);
	return EXIT_ERROR;
}

/**
 * Run the move the flags described and report what it did.
 *
 * @param inputs - The destination, the flags, and the loaded project.
 * @param resolved - The command's resolved dependency slots.
 * @returns The exit code the command closes on.
 */
async function moveAsync(
	{ destination, options, project }: MoveInputs,
	resolved: ResolvedStateMove,
): Promise<number> {
	const moved = await resolved.moveState(
		{
			fetch: resolved.fetch,
			getEnv: buildEnvironmentReader(options.common),
			plugins: project.plugins,
		},
		{
			config: project.config,
			destination,
			environments: options.common.environments,
			force: options.force,
		},
	);
	if (!moved.success) {
		renderMoveStateError(moved.err, resolved.clack);
		return failed(resolved);
	}

	renderStateMoveOutcome(
		{ destination: destination.backend, outcome: moved.data },
		resolved.clack,
	);
	resolved.clack.outro(`${COMMAND} succeeded`);
	return EXIT_OK;
}

async function runAsync(
	rawOptions: Readonly<Record<string, unknown>>,
	resolved: ResolvedStateMove,
): Promise<number> {
	resolved.clack.intro(`bedrock ${COMMAND}`);

	const parsed = parseStateMoveOptions(rawOptions);
	if (!parsed.success) {
		renderParseError(parsed.err, resolved.clack);
		return failed(resolved);
	}

	const loaded = await resolved.loadProject(loadOptionsFor(parsed.data.common));
	if (!loaded.success) {
		renderDeployError({ cause: loaded.err, kind: "configLoadFailed" }, resolved.clack);
		return failed(resolved);
	}

	const destination = resolveMoveDestination(parsed.data, loaded.data.plugins);
	if (!destination.success) {
		renderMoveDestinationError(destination.err, resolved.clack);
		return failed(resolved);
	}

	return moveAsync(
		{ destination: destination.data, options: parsed.data, project: loaded.data },
		resolved,
	);
}
