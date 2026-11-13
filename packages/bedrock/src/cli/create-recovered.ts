import type {
	CreateRecoveredEvent,
	CreateRecoveryUnavailableEvent,
	ProgressEvent,
} from "../ports/progress-port.ts";
import { applyCauseDetail } from "./failure-detail.ts";

/**
 * A create recovery notice: a recovered create, or one recovery could not
 * check.
 */
export type CreateRecoveryEvent = CreateRecoveredEvent | CreateRecoveryUnavailableEvent;

/**
 * Whether a progress event is a create recovery notice.
 *
 * @param event - Any progress event.
 * @returns `true` for `createRecovered` and `createRecoveryUnavailable`.
 */
export function isCreateRecoveryEvent(event: ProgressEvent): event is CreateRecoveryEvent {
	return event.kind === "createRecovered" || event.kind === "createRecoveryUnavailable";
}

/**
 * Render the notice for a create Roblox completed but answered with an error,
 * or for a failed create that recovery could not check.
 *
 * @param event - The recovered create, its recorded ID and the failure; or
 *   the failed create recovery could not check.
 * @returns One line naming the resource and what happened.
 */
export function recoveryLine(event: CreateRecoveryEvent): string {
	if (event.kind === "createRecoveryUnavailable") {
		return `Warning: ${event.resourceKind}.${event.key} create was not recovered: create recovery needs the live check, and this deploy listed no ${event.resourceKind} items before Apply. Roblox may have made the item.`;
	}

	const failure = applyCauseDetail({ key: event.key, cause: event.cause, kind: "driverFailure" });
	return `${event.resourceKind}.${event.key} create recovered (id ${event.robloxId}): Roblox made it although the create failed: ${failure}`;
}
