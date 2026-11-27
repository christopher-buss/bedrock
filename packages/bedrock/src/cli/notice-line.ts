import type {
	BadgeCreatesDeferredEvent,
	DeclarationReportEvent,
	ProgressEvent,
	ResourceImportedEvent,
	StartPlaceFieldSkippedEvent,
	UnconfirmedPaidCreatesSkippedEvent,
} from "../ports/progress-port.ts";
import {
	type CreateRecoveryEvent,
	isCreateRecoveryEvent,
	recoveryLine,
} from "./create-recovered.ts";
import { declarationReportLine } from "./declaration-report.ts";
import { deferredCreatesLine } from "./deferred-creates.ts";
import { unconfirmedCreatesDetail } from "./unconfirmed-paid-creates.ts";

/**
 * A deploy event that renders as one {@link noticeLine} as soon as it arrives.
 */
export type NoticeLineEvent =
	| CreateRecoveryEvent
	| ResourceImportedEvent
	| StartPlaceFieldSkippedEvent
	| UnconfirmedPaidCreatesSkippedEvent;

/**
 * Whether a deploy event renders as one {@link noticeLine} as soon as it
 * arrives.
 *
 * @param event - Any deploy progress event.
 * @returns `true` for a create recovery notice, an import, a skipped start
 *   place field, or skipped Unconfirmed paid creates.
 */
export function isNoticeLineEvent(event: ProgressEvent): event is NoticeLineEvent {
	return (
		isCreateRecoveryEvent(event) ||
		event.kind === "resourceImported" ||
		event.kind === "startPlaceFieldSkipped" ||
		event.kind === "unconfirmedPaidCreatesSkipped"
	);
}

/**
 * Render one informational deploy event as a single line.
 *
 * @param event - The deferred creates, create recovery notice, declaration report,
 *   import, or skipped start place field.
 * @returns The line to log.
 */
export function noticeLine(
	event: BadgeCreatesDeferredEvent | DeclarationReportEvent | NoticeLineEvent,
): string {
	switch (event.kind) {
		case "badgeCreatesDeferred": {
			return deferredCreatesLine(event);
		}
		case "createRecovered":
		case "createRecoveryUnavailable": {
			return recoveryLine(event);
		}
		case "declarationReport": {
			return declarationReportLine(event.report);
		}
		case "resourceImported": {
			return `< ${event.resourceKind}:${event.key} (id ${event.robloxId}) imported`;
		}
		case "startPlaceFieldSkipped": {
			return `Warning: place:${event.key} ${event.field} is not used; universe.${event.field} wins on the start place.`;
		}
		case "unconfirmedPaidCreatesSkipped": {
			return `badge creates skipped in "${event.environment}": ${unconfirmedCreatesDetail(event.creates)}`;
		}
	}
}
