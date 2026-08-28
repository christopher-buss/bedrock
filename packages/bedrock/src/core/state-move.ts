import type { Result } from "@bedrock-rbx/ocale";

import type { BedrockState, StateError, StateRecord, StateVersion } from "./state.ts";

/**
 * Why one **Environment** cannot be moved.
 *
 * A side that cannot be read is told apart from a destination that is
 * simply occupied, because one is a store the operator has to fix and the
 * other is a state they have to decide about.
 *
 * @since 0.2.2
 */
export type StateMoveBlocker =
	| {
			/** The **State** the destination already holds. */
			readonly held: BedrockState;
			/** Literal discriminator for narrowing. */
			readonly kind: "destinationOccupied";
	  }
	| {
			/** Why the destination could not be read. */
			readonly err: StateError;
			/** Literal discriminator for narrowing. */
			readonly kind: "destinationUnreadable";
	  }
	| {
			/** Why the source could not be read. */
			readonly err: StateError;
			/** Literal discriminator for narrowing. */
			readonly kind: "sourceUnreadable";
	  };

/**
 * What the survey decided about one **Environment**: the **State** to
 * write, the reason there is nothing to write, or the reason it cannot be
 * written.
 *
 * @since 0.2.2
 */
export type StateMoveDecision =
	| {
			/**
			 * The record the write is fenced against, or `undefined` when it
			 * is unconditional: a **Backend** with no version primitive names
			 * no record, and a forced move overwrites whatever is there.
			 */
			readonly expected: StateVersion | undefined;
			/** Literal discriminator for narrowing. */
			readonly kind: "move";
			/** The **State** read out of the source. */
			readonly state: BedrockState;
	  }
	| {
			/** Literal discriminator for narrowing. */
			readonly kind: "blocked";
			/** What stands in the way. */
			readonly reason: StateMoveBlocker;
	  }
	| {
			/** Literal discriminator for narrowing. */
			readonly kind: "skip";
			/** Why there is nothing to move. */
			readonly reason: "sourceEmpty";
	  };

/** What one **Environment** looked like on both sides, both reads done. */
export interface StateMoveSurvey {
	/** What the destination held when it was read. */
	readonly destination: Result<StateRecord, StateError>;
	/** **Environment** the two reads belong to. */
	readonly environment: string;
	/** What the source held when it was read. */
	readonly source: Result<StateRecord, StateError>;
}

/** How the caller wants an occupied destination treated. */
interface PlanStateMoveOptions {
	/**
	 * Whether to overwrite a destination that already holds state. A forced
	 * move writes unfenced, which is what makes it able to land on a record
	 * the survey never saw.
	 */
	readonly force: boolean;
}

/**
 * Decide what happens to every surveyed **Environment**.
 *
 * The caller performs both reads and hands them over, so the decision that
 * governs whether a state is overwritten is a pure function of what was
 * read. A caller writes only once no decision is `blocked`: an operator
 * whose move stops half way has their state split across two **Backend**s
 * with nothing recording which environments went where.
 *
 * @param surveys - Each **Environment**'s two reads.
 * @param options - How an occupied destination is treated.
 * @returns One decision per surveyed **Environment**, keyed by its name.
 */
export function planStateMove(
	surveys: ReadonlyArray<StateMoveSurvey>,
	options: PlanStateMoveOptions,
): ReadonlyMap<string, StateMoveDecision> {
	return new Map(
		surveys.map((survey) => [survey.environment, decide(survey, options.force)] as const),
	);
}

function decide(survey: StateMoveSurvey, force: boolean): StateMoveDecision {
	if (!survey.source.success) {
		return { kind: "blocked", reason: { err: survey.source.err, kind: "sourceUnreadable" } };
	}

	if (!survey.destination.success) {
		return {
			kind: "blocked",
			reason: { err: survey.destination.err, kind: "destinationUnreadable" },
		};
	}

	const { state } = survey.source.data;
	if (state === undefined) {
		return { kind: "skip", reason: "sourceEmpty" };
	}

	const held = survey.destination.data.state;
	if (held !== undefined && !force) {
		return { kind: "blocked", reason: { held, kind: "destinationOccupied" } };
	}

	return {
		expected: force ? undefined : survey.destination.data.version,
		kind: "move",
		state,
	};
}
