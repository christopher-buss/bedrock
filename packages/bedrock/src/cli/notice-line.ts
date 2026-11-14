import type {
	BadgeCreatesDeferredEvent,
	DeclarationReportEvent,
	ProgressEvent,
	ResourceImportedEvent,
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
 * Whether a deploy event renders as one {@link noticeLine} as soon as it
 * arrives.
 *
 * @param event - Any deploy progress event.
 * @returns `true` for a create recovery notice, an import, or skipped
 *   Unconfirmed paid creates.
 */
export function isNoticeLineEvent(
	event: ProgressEvent,
): event is CreateRecoveryEvent | ResourceImportedEvent | UnconfirmedPaidCreatesSkippedEvent {
	return (
		isCreateRecoveryEvent(event) ||
		event.kind === "resourceImported" ||
		event.kind === "unconfirmedPaidCreatesSkipped"
	);
}

/**
 * Render one informational deploy event as a single line.
 *
 * @param event - The deferred creates, create recovery notice, declaration report, or
 *   import.
 * @returns The line to log.
 */
export function noticeLine(
	event:
		| BadgeCreatesDeferredEvent
		| CreateRecoveryEvent
		| DeclarationReportEvent
		| ResourceImportedEvent
		| UnconfirmedPaidCreatesSkippedEvent,
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
		case "unconfirmedPaidCreatesSkipped": {
			return `badge creates skipped in "${event.environment}": ${unconfirmedCreatesDetail(event.creates)}`;
		}
	}
}
