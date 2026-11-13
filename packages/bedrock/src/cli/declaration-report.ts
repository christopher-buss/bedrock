import type { DeclarationReport } from "../core/declaration-report.ts";

const IMPORT_LINES: ReadonlySet<DeclarationReport["declaration"]> = new Set([
	"iconBaseline",
	"importId",
]);

/**
 * Render persisted status, reserving cleanup advice for completely known
 * absence.
 * @param report - Persisted status of one authored declaration.
 * @returns Cleanup advice, active environments and any unknown environments.
 */
export function declarationReportLine(report: DeclarationReport): string {
	const oldKey = report.declaration === "movedFrom" ? ` "${report.oldKey}"` : "";
	const scope = report.environment === undefined ? "" : ` (environment "${report.environment}")`;
	const imported = IMPORT_LINES.has(report.declaration);
	const statuses: Array<string> = [];
	if (report.activeEnvironments.length > 0) {
		const status = imported ? "Still needed in" : "Still active in";
		statuses.push(`${status}: ${report.activeEnvironments.join(", ")}.`);
	}

	if (report.unknownEnvironments.length > 0) {
		statuses.push(`Unknown in: ${report.unknownEnvironments.join(", ")}.`);
	}

	if (statuses.length === 0) {
		statuses.push(
			imported
				? "Safe to drop declaration (imported into persisted state)."
				: "Safe to drop declaration (absent from every environment's persisted state).",
		);
	}

	return `${report.resourceKind}:${report.key} ${report.declaration}${oldKey}${scope}: ${statuses.join(" ")}`;
}
