import type { DeclarationReport } from "../core/declaration-report.ts";

/**
 * Render persisted status, reserving cleanup advice for completely known
 * absence.
 * @param report - Persisted status of one authored declaration.
 * @returns Cleanup advice, active environments and any unknown environments.
 */
export function declarationReportLine(report: DeclarationReport): string {
	const oldKey = report.declaration === "movedFrom" ? ` "${report.oldKey}"` : "";
	const scope = report.environment === undefined ? "" : ` (environment "${report.environment}")`;
	const statuses: Array<string> = [];
	if (report.activeEnvironments.length > 0) {
		statuses.push(`Still active in: ${report.activeEnvironments.join(", ")}.`);
	}

	if (report.unknownEnvironments.length > 0) {
		statuses.push(`Unknown in: ${report.unknownEnvironments.join(", ")}.`);
	}

	if (statuses.length === 0) {
		statuses.push(
			"Safe to drop declaration (absent from every environment's persisted state).",
		);
	}

	return `${report.resourceKind}:${report.key} ${report.declaration}${oldKey}${scope}: ${statuses.join(" ")}`;
}
