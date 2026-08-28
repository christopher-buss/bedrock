import type { ConfigValidationIssue } from "../core/config-error.ts";
import type { StateMoveBlocker } from "../core/state-move.ts";
import type { MoveStateError, StateBackendUnavailable } from "../shell/move-state.ts";
import {
	buildStatePortErrorMessage,
	deployErrorMessage,
	stateErrorDetail,
} from "./error-messages.ts";
import type { StateMoveDestinationError } from "./state-move-destination.ts";

/**
 * Describe why the flags did not name a destination that could be reached.
 *
 * Each variant names what to write instead: a move is run once in a
 * project's life, so nobody arrives knowing its flags.
 *
 * @param err - What the destination resolution refused.
 * @returns One line per problem, in the order they should be read.
 */
export function moveDestinationMessages(err: StateMoveDestinationError): ReadonlyArray<string> {
	switch (err.kind) {
		case "invalidCoordinates": {
			return err.issues.map((issue) => coordinateIssueMessage(issue));
		}
		case "noDestination": {
			return [
				`no destination: pass --to with one of ${err.available.join(", ")} and the coordinates it needs`,
			];
		}
		case "unknownBackend": {
			return [
				`no backend named '${err.received}'; the ones there are: ${err.available.join(", ")}`,
			];
		}
	}
}

/**
 * Describe why a move did not happen.
 *
 * @param err - What stopped the move.
 * @returns One line per problem, in the order they should be read.
 */
export function moveStateErrorMessages(err: MoveStateError): ReadonlyArray<string> {
	switch (err.kind) {
		case "destinationUnavailable": {
			return [`the destination could not be reached: ${backendUnavailableDetail(err.cause)}`];
		}
		case "lockAcquireFailed": {
			return [`${err.environment}: could not be held for the move: ${err.cause.reason}`];
		}
		case "moveBlocked": {
			return Array.from(err.blocked, ([environment, blocker]) => {
				return moveBlockerMessage(environment, blocker);
			});
		}
		case "sourceUnavailable": {
			return [
				`${err.environment}: its source could not be reached: ${backendUnavailableDetail(err.cause)}`,
			];
		}
		case "writeFailed": {
			return [
				`state write failed for '${err.environment}' ${stateErrorDetail(err.cause)}`,
				alreadyMovedMessage(err.moved),
			];
		}
	}
}

/**
 * Name the flag one problem belongs to. A `state` block's keys are its
 * own, so the flag is the first path segment whatever the schema
 * attributed the problem to.
 *
 * @param issue - One problem the destination's schema reported.
 * @returns The line naming the flag that carries it.
 */
function coordinateIssueMessage(issue: ConfigValidationIssue): string {
	return `--to-${String(issue.path[0])}: ${issue.message}`;
}

function alreadyMovedMessage(moved: ReadonlyArray<string>): string {
	return moved.length === 0
		? "nothing had moved yet, so both stores are as they were"
		: `${moved.join(", ")} is now on both sides; the source copy of each is still there`;
}

function backendUnavailableDetail(cause: StateBackendUnavailable): string {
	return cause.kind === "stateNotConfigured"
		? deployErrorMessage(cause)
		: buildStatePortErrorMessage(cause);
}

function moveBlockerMessage(environment: string, blocker: StateMoveBlocker): string {
	switch (blocker.kind) {
		case "destinationOccupied": {
			return `${environment}: the destination already holds state for it; pass --force to overwrite`;
		}
		case "destinationUnreadable": {
			return `${environment}: the destination could not be read ${stateErrorDetail(blocker.err)}`;
		}
		case "sourceUnreadable": {
			return `${environment}: the source could not be read ${stateErrorDetail(blocker.err)}`;
		}
	}
}
