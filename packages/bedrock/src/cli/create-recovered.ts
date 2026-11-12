import type { CreateRecoveredEvent } from "../ports/progress-port.ts";
import { applyCauseDetail } from "./failure-detail.ts";

/**
 * Render the notice for a create Roblox completed but answered with an error.
 *
 * @param event - The recovered create, its recorded ID and the failure.
 * @returns One line naming the resource, its ID and the failure.
 */
export function createRecoveredLine(event: CreateRecoveredEvent): string {
	const failure = applyCauseDetail({ key: event.key, cause: event.cause, kind: "driverFailure" });
	return `${event.resourceKind}.${event.key} create recovered (id ${event.robloxId}): Roblox made it although the create failed: ${failure}`;
}
