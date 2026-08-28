import type { Result } from "@bedrock-rbx/ocale";

import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { PluginRegistry } from "../core/plugin-registry.ts";
import { resolveStateConfig, type StateNotConfiguredError } from "../core/resolve-state-config.ts";
import type { Config, StateConfig } from "../core/schema.ts";
import type { StateLockingCapability } from "../core/state-locking.ts";
import {
	planStateMove,
	type StateMoveBlocker,
	type StateMoveDecision,
	type StateMoveSurvey,
} from "../core/state-move.ts";
import type { StateError } from "../core/state.ts";
import type { StateLockError, StateLockHold, StateLockPort } from "../ports/state-lock-port.ts";
import type { StatePort } from "../ports/state-port.ts";
import {
	buildStateBackend,
	buildStatePort,
	type MissingCredentialError,
	type PluginStateBackendError,
	type UnsupportedBackendError,
} from "./build-state-port.ts";

/** What a hold this command takes is recorded as. */
const OPERATION = "state move";

/** Why one side's **Backend** could not be reached at all. */
export type StateBackendUnavailable =
	| MissingCredentialError
	| PluginStateBackendError
	| StateNotConfiguredError
	| UnsupportedBackendError;

/**
 * Why a move did not happen.
 *
 * `moveBlocked` is the survey's answer and carries every **Environment**
 * standing in the way at once, because an operator fixing one only to meet
 * the next has learned nothing they could not have been told up front.
 */
export type MoveStateError =
	| {
			/** What stands in the way, keyed by **Environment**. */
			readonly blocked: ReadonlyMap<string, StateMoveBlocker>;
			/** Literal discriminator for narrowing. */
			readonly kind: "moveBlocked";
	  }
	| {
			/** Why the **Backend** refused the write. */
			readonly cause: StateError;
			/** **Environment** whose write was refused. */
			readonly environment: string;
			/** Literal discriminator for narrowing. */
			readonly kind: "writeFailed";
			/** **Environment**s already written, which are on both sides. */
			readonly moved: ReadonlyArray<string>;
	  }
	| {
			/** Why the destination could not be reached. */
			readonly cause: StateBackendUnavailable;
			/** Literal discriminator for narrowing. */
			readonly kind: "destinationUnavailable";
	  }
	| {
			/** Why the hold was refused. */
			readonly cause: StateLockError;
			/** **Environment** whose hold was refused. */
			readonly environment: string;
			/** Literal discriminator for narrowing. */
			readonly kind: "lockAcquireFailed";
	  }
	| {
			/** Why the source could not be reached. */
			readonly cause: StateBackendUnavailable;
			/** **Environment** whose source could not be reached. */
			readonly environment: string;
			/** Literal discriminator for narrowing. */
			readonly kind: "sourceUnavailable";
	  };

/** What a completed move did. */
export interface StateMoveOutcome {
	/** What the survey decided, keyed by **Environment**. */
	readonly decisions: ReadonlyMap<string, StateMoveDecision>;
	/**
	 * The exclusion each **Environment** moved under, keyed by its name, so
	 * a move that ran without a hold says so rather than implying one.
	 */
	readonly locking: ReadonlyMap<string, StateLockingCapability>;
	/** **Environment**s whose state reached the destination, in order. */
	readonly moved: ReadonlyArray<string>;
}

/** Seams {@link moveStateAsync} builds both sides' **Backend**s through. */
export interface MoveStateDeps {
	/** `fetch` override plumbed into a default-constructed adapter. */
	readonly fetch?: GistFetch;
	/** Reads an environment variable, which is where credentials come from. */
	readonly getEnv: (name: string) => string | undefined;
	/** What the loaded plugins declared, which names the valid backends. */
	readonly plugins?: PluginRegistry;
}

/** What one move covers. */
export interface MoveStateInputs {
	/** Validated project config, whose `state` blocks name the source. */
	readonly config: Config;
	/** The `state` block naming where the state is being moved to. */
	readonly destination: StateConfig;
	/** **Environment**s to move, which the caller named. */
	readonly environments: ReadonlyArray<string>;
	/** Whether to overwrite a destination that already holds state. */
	readonly force: boolean;
}

/** What building every source port needs. */
interface BuildSourcePortsInputs {
	/** Credential and transport seams to build over. */
	readonly deps: MoveStateDeps;
	/** The port every write goes through. */
	readonly destination: StatePort;
	/** The project and the **Environment**s being moved. */
	readonly inputs: MoveStateInputs;
}

/** One **Environment**'s ports, and the exclusion its source offers. */
interface EnvironmentPorts {
	readonly destination: StatePort;
	readonly environment: string;
	readonly locking: StateLockingCapability;
	readonly source: StatePort;
	readonly stateLockPort: StateLockPort | undefined;
}

/**
 * Move every named **Environment**'s **State** from the **Backend** its
 * config names onto another.
 *
 * Both sides are read for every **Environment** before anything is
 * written. A move that wrote as it went and stopped half way would leave a
 * project split across two **Backend**s with nothing recording which
 * environments went where, so a single **Environment** that cannot be
 * moved fails the whole move while both stores are still as they were.
 *
 * The source is left holding what it held. Deleting the operator's other
 * copy of their own state is a separate decision with a blast radius of
 * its own.
 *
 * @param deps - Credential and transport seams the **Backend**s build over.
 * @param inputs - The project, the destination, and what to move.
 * @returns What the survey decided and which **Environment**s landed, or a
 * typed failure naming what stopped the move.
 */
export async function moveStateAsync(
	deps: MoveStateDeps,
	inputs: MoveStateInputs,
): Promise<Result<StateMoveOutcome, MoveStateError>> {
	const destination = buildPort(deps, inputs.destination);
	if (!destination.success) {
		return { err: { cause: destination.err, kind: "destinationUnavailable" }, success: false };
	}

	const ports = buildSourcePorts({ deps, destination: destination.data, inputs });
	if (!ports.success) {
		return ports;
	}

	return withHoldsAsync(ports.data, async () => moveHeldAsync(ports.data, inputs.force));
}

function blockedOf(
	decisions: ReadonlyMap<string, StateMoveDecision>,
): ReadonlyMap<string, StateMoveBlocker> {
	return new Map(
		[...decisions].flatMap(([environment, decision]) => {
			return decision.kind === "blocked" ? [[environment, decision.reason] as const] : [];
		}),
	);
}

async function surveyAsync({
	destination,
	environment,
	source,
}: EnvironmentPorts): Promise<StateMoveSurvey> {
	const [sourceRead, destinationRead] = await Promise.all([
		source.read(environment),
		destination.read(environment),
	]);
	return { destination: destinationRead, environment, source: sourceRead };
}

function lockingOf(
	ports: ReadonlyArray<EnvironmentPorts>,
): ReadonlyMap<string, StateLockingCapability> {
	return new Map(ports.map(({ environment, locking }) => [environment, locking] as const));
}

/**
 * Write every **Environment** the survey cleared, in the order it was
 * named.
 *
 * @param ports - Both ports per **Environment**.
 * @param decisions - What the survey decided for each of them.
 * @returns What landed, or the refusal plus what had landed before it.
 */
async function writeAllAsync(
	ports: ReadonlyArray<EnvironmentPorts>,
	decisions: ReadonlyMap<string, StateMoveDecision>,
): Promise<Result<StateMoveOutcome, MoveStateError>> {
	const moved: Array<string> = [];
	for (const { destination, environment } of ports) {
		const decision = decisions.get(environment);
		if (decision?.kind !== "move") {
			continue;
		}

		const written = await destination.write(decision.state, decision.expected);
		if (!written.success) {
			return {
				err: { cause: written.err, environment, kind: "writeFailed", moved },
				success: false,
			};
		}

		moved.push(environment);
	}

	return { data: { decisions, locking: lockingOf(ports), moved }, success: true };
}

/**
 * Survey both sides, decide, and write whatever the survey cleared.
 *
 * @param ports - Both ports per **Environment**.
 * @param force - Whether to overwrite an occupied destination.
 * @returns What landed, or what stopped the move.
 */
async function moveHeldAsync(
	ports: ReadonlyArray<EnvironmentPorts>,
	force: boolean,
): Promise<Result<StateMoveOutcome, MoveStateError>> {
	const surveys = await Promise.all(ports.map(surveyAsync));
	const decisions = planStateMove(surveys, { force });
	const blocked = blockedOf(decisions);
	if (blocked.size > 0) {
		return { err: { blocked, kind: "moveBlocked" }, success: false };
	}

	return writeAllAsync(ports, decisions);
}

async function releaseAllAsync(holds: ReadonlyArray<StateLockHold>): Promise<void> {
	await Promise.all(holds.map(async (hold) => hold.release()));
}

/**
 * Take a hold on every **Environment** whose source offers one, run the
 * move under them, and give every hold back however it ended.
 *
 * A **Backend** that offers no exclusion is moved without a hold rather
 * than refused, which is the same bargain a deploy against it strikes. A hold
 * that could not be given up never changes the move's own result: the
 * state has already landed, and reporting otherwise would send an operator
 * looking for a failure that did not happen.
 *
 * @param ports - Both ports per **Environment**, in the order named.
 * @param runAsync - The move to run under the holds.
 * @returns What the move returned, or the hold that was refused.
 */
async function withHoldsAsync(
	ports: ReadonlyArray<EnvironmentPorts>,
	runAsync: () => Promise<Result<StateMoveOutcome, MoveStateError>>,
): Promise<Result<StateMoveOutcome, MoveStateError>> {
	const holds: Array<StateLockHold> = [];
	for (const { environment, stateLockPort } of ports) {
		if (stateLockPort === undefined) {
			continue;
		}

		const hold = await stateLockPort.acquire(environment, { operation: OPERATION });
		if (!hold.success) {
			await releaseAllAsync(holds);
			return {
				err: { cause: hold.err, environment, kind: "lockAcquireFailed" },
				success: false,
			};
		}

		holds.push(hold.data);
	}

	try {
		return await runAsync();
	} finally {
		await releaseAllAsync(holds);
	}
}

function buildPort(
	deps: MoveStateDeps,
	stateConfig: StateConfig,
): Result<StatePort, StateBackendUnavailable> {
	return buildStatePort({ ...deps, stateConfig });
}

/**
 * Build one source port per **Environment**, pairing each with the one
 * destination port every write goes through.
 *
 * @param built - The seams to build over, the destination every write goes
 *   through, and the **Environment**s being moved.
 * @returns Both ports per **Environment**, or the first one that refused.
 */
function buildSourcePorts({
	deps,
	destination,
	inputs,
}: BuildSourcePortsInputs): Result<ReadonlyArray<EnvironmentPorts>, MoveStateError> {
	const ports: Array<EnvironmentPorts> = [];
	for (const environment of inputs.environments) {
		const stateConfig = resolveStateConfig(inputs.config, environment);
		if (!stateConfig.success) {
			return {
				err: { cause: stateConfig.err, environment, kind: "sourceUnavailable" },
				success: false,
			};
		}

		const source = buildStateBackend({ ...deps, stateConfig: stateConfig.data });
		if (!source.success) {
			return {
				err: { cause: source.err, environment, kind: "sourceUnavailable" },
				success: false,
			};
		}

		ports.push({
			destination,
			environment,
			locking: source.data.locking,
			source: source.data.statePort,
			stateLockPort: source.data.stateLockPort,
		});
	}

	return { data: ports, success: true };
}
