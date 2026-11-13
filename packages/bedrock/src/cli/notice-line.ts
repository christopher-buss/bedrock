import type {
	BadgeCreatesDeferredEvent,
	DeclarationReportEvent,
	ResourceImportedEvent,
} from "../ports/progress-port.ts";
import { type CreateRecoveryEvent, recoveryLine } from "./create-recovered.ts";
import { declarationReportLine } from "./declaration-report.ts";
import { deferredCreatesLine } from "./deferred-creates.ts";

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
		| ResourceImportedEvent,
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
	}
}
