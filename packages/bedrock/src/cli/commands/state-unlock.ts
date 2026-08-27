import process from "node:process";

import type { PluginRegistry } from "../../core/plugin-registry.ts";
import type { Config } from "../../core/schema.ts";
import type { StateLockHolding } from "../../ports/state-lock-port.ts";
import {
	forceReleaseStateLockAsync as defaultForceReleaseStateLock,
	type ForceReleaseStateLockError,
	type ForceReleaseStateLockOutcome,
} from "../../shell/force-release-state-lock.ts";
import { loadProjectAsync as defaultLoadProject } from "../../shell/load-config.ts";
import { createClackPort } from "../clack-port.ts";
import { buildEnvironmentReader } from "../credential-environment-overrides.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps } from "../index.ts";
import { type ClackPort, renderDeployError } from "../render.ts";
import { startCommandAsync } from "./start-command.ts";

const COMMAND = "state unlock";

/** The command's dependency slots, each resolved to a real default. */
interface ResolvedStateUnlock {
	readonly clack: ClackPort;
	readonly exit: (code: number) => void;
	readonly forceReleaseStateLock: typeof defaultForceReleaseStateLock;
	readonly loadProject: typeof defaultLoadProject;
}

/** One environment's release, over the project the command loaded once. */
interface ReleaseInputs {
	/** The validated project config. */
	readonly config: Config;
	/** **Environment** whose hold is being taken away. */
	readonly environment: string;
	/** Reads an environment variable, with the command's overrides applied. */
	readonly getEnvironment: (name: string) => string | undefined;
	/** What the loaded plugins declared. */
	readonly plugins: PluginRegistry;
	/** The command's resolved dependency slots. */
	readonly resolved: ResolvedStateUnlock;
}

/**
 * Build the sade action for `bedrock state unlock`. Takes the hold on each
 * `--env` away, whoever holds it, so an **Environment** a killed deploy
 * left held is deployable again without waiting out a **Lease**.
 *
 * Every failure is reported against the environment it belongs to and the
 * remaining environments still run; the aggregated exit code is `EXIT_OK`
 * only when every environment was released.
 *
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function stateUnlockCommand(
	deps: ProgDeps,
): (rawOptions: Readonly<Record<string, unknown>>) => Promise<void> {
	const resolved = resolveStateUnlock(deps);
	return async (rawOptions) => {
		const code = await runAsync(rawOptions, resolved);
		resolved.exit(code);
	};
}

function resolveStateUnlock(deps: ProgDeps): ResolvedStateUnlock {
	return {
		clack: deps.clack ?? createClackPort(),
		exit: deps.exit ?? ((code: number) => process.exit(code)),
		forceReleaseStateLock: deps.forceReleaseStateLock ?? defaultForceReleaseStateLock,
		loadProject: deps.loadProject ?? defaultLoadProject,
	};
}

/**
 * Name who held an **Environment** out of whatever the **Backend**'s lock
 * record carried, which is best effort by contract.
 *
 * @param displaced - The hold as the **Backend** reported it.
 * @returns The phrase naming the holder.
 */
function describeDisplaced(displaced: StateLockHolding): string {
	if (displaced.owner === undefined) {
		return "was held by another run";
	}

	const operation = displaced.operation === undefined ? "" : ` for ${displaced.operation}`;
	const since = displaced.since === undefined ? "" : ` since ${displaced.since}`;
	return `was held by ${displaced.owner}${operation}${since}`;
}

/**
 * Report what one release did, in terms of the **Environment** rather than
 * of the lock record.
 *
 * @param outcome - What the release found and took away.
 * @returns The line to log.
 */
function describeOutcome(outcome: ForceReleaseStateLockOutcome): string {
	const environment = `"${outcome.environment}"`;
	switch (outcome.locking) {
		case "disabled": {
			return `locking is off for ${environment} by config, so there is no hold to take away`;
		}
		case "exclusive": {
			return outcome.displaced === undefined
				? `nothing was holding ${environment}`
				: `${environment} ${describeDisplaced(outcome.displaced)}, and is not held now`;
		}
		case "none": {
			return `${environment} runs on a backend that takes no hold, so there is none to take away`;
		}
	}
}

/**
 * Report why one release could not be done.
 *
 * @param err - What went wrong.
 * @param clack - Where the line is written.
 */
function renderReleaseError(err: ForceReleaseStateLockError, clack: ClackPort): void {
	if (err.kind === "lockReleaseFailed") {
		clack.logError(`the hold could not be taken away: ${err.cause.reason}`);
		return;
	}

	renderDeployError(err, clack);
}

/**
 * Take one environment's hold away, reporting whichever way it went.
 *
 * @param inputs - The environment being released and the resolved deps.
 * @returns Whether nothing is holding the environment now.
 */
async function releaseEnvironmentAsync(inputs: ReleaseInputs): Promise<boolean> {
	const { environment, resolved } = inputs;
	resolved.clack.logMessage(
		`Taking the hold on "${environment}" away: a deploy still holding it keeps running, and fails its own state write rather than overwriting whatever runs next.`,
	);

	const released = await resolved.forceReleaseStateLock({
		config: inputs.config,
		environment,
		getEnv: inputs.getEnvironment,
		plugins: inputs.plugins,
	});
	if (!released.success) {
		renderReleaseError(released.err, resolved.clack);
		return false;
	}

	resolved.clack.logSuccess(describeOutcome(released.data));
	return true;
}

async function runAsync(
	rawOptions: Readonly<Record<string, unknown>>,
	resolved: ResolvedStateUnlock,
): Promise<number> {
	const started = await startCommandAsync(
		{ clack: resolved.clack, command: COMMAND, loadProject: resolved.loadProject },
		rawOptions,
	);
	if (!started.success) {
		return EXIT_ERROR;
	}

	const { loaded, parsed } = started.data;
	const getEnvironment = buildEnvironmentReader(parsed);
	let released = true;
	for (const environment of parsed.environments) {
		const ok = await releaseEnvironmentAsync({
			config: loaded.config,
			environment,
			getEnvironment,
			plugins: loaded.plugins,
			resolved,
		});
		released &&= ok;
	}

	if (!released) {
		resolved.clack.cancel(`${COMMAND} failed`);
		return EXIT_ERROR;
	}

	resolved.clack.outro(`${COMMAND} succeeded`);
	return EXIT_OK;
}
