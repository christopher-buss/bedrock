import type { MigrationReportFile, MigrationWarning } from "./migration-report.ts";

interface SectionInput<W> {
	readonly entry: (warning: W) => string;
	readonly groupKey: (warning: W) => string;
	readonly title: string;
	readonly warnings: ReadonlyArray<W>;
}

/**
 * Render a {@link MigrationReportFile} as the Markdown body written to
 * `.bedrock/migration-report.md`. Pure derivation: the same input shape
 * the JSON serializer consumes feeds this renderer, so the Markdown view
 * round-trips through the JSON file.
 *
 * Output structure:
 * - Header with the four counts.
 * - Sections in user-action priority order (Action required, Blocked,
 *   Deferred, Interpretive). Sections with no matching warnings are
 *   omitted entirely.
 * - Within each section, warnings are grouped by their non-path
 *   discriminator (`hint` for ambiguous, `reason` for blocked/deferred,
 *   `rule` for interpretive). First-appearance order is preserved.
 * - Interpretive entries render as `mantlePath -> bedrockPath` so the
 *   user can verify the auto-applied mapping at a glance.
 *
 * @param file - The summary plus warnings to render.
 * @returns Markdown source ending with a trailing newline.
 */
export function renderMigrationReportMarkdown(file: MigrationReportFile): string {
	const sections = [
		renderActionRequired(file.warnings),
		renderBlocked(file.warnings),
		renderDeferred(file.warnings),
		renderInterpretive(file.warnings),
	].filter((section) => section !== "");

	const header = renderHeader(file);
	return [header, ...sections].join("\n");
}

function renderHeader(file: MigrationReportFile): string {
	return [
		"# Migration report",
		"",
		`ambiguous: ${String(file.summary.ambiguousCount)}`,
		`blocked: ${String(file.summary.blockedCount)}`,
		`deferred: ${String(file.summary.deferredCount)}`,
		`interpretive: ${String(file.summary.interpretiveCount)}`,
		"",
	].join("\n");
}

function groupByKey<W>(
	warnings: ReadonlyArray<W>,
	key: (warning: W) => string,
): ReadonlyMap<string, ReadonlyArray<W>> {
	const orderedKeys = [...new Set(warnings.map(key))];
	return new Map(
		orderedKeys.map((groupKey) => [
			groupKey,
			warnings.filter((warning) => key(warning) === groupKey),
		]),
	);
}

function renderSection<W>(input: SectionInput<W>): string {
	if (input.warnings.length === 0) {
		return "";
	}

	const groups = groupByKey(input.warnings, input.groupKey);
	const blocks = [...groups].map(([key, members]) => {
		const lines = members.map((warning) => `- ${input.entry(warning)}`);
		return [`### ${key}`, "", ...lines, ""].join("\n");
	});

	return [`## ${input.title}`, "", ...blocks].join("\n");
}

function renderActionRequired(warnings: ReadonlyArray<MigrationWarning>): string {
	return renderSection({
		entry: (warning) => warning.mantlePath,
		groupKey: (warning) => warning.hint,
		title: "Action required",
		warnings: warnings.filter(
			(warning): warning is Extract<MigrationWarning, { kind: "ambiguous" }> => {
				return warning.kind === "ambiguous";
			},
		),
	});
}

function renderBlocked(warnings: ReadonlyArray<MigrationWarning>): string {
	return renderSection({
		entry: (warning) => warning.mantlePath,
		groupKey: (warning) => warning.reason,
		title: "Blocked",
		warnings: warnings.filter(
			(warning): warning is Extract<MigrationWarning, { kind: "blocked" }> => {
				return warning.kind === "blocked";
			},
		),
	});
}

function renderDeferred(warnings: ReadonlyArray<MigrationWarning>): string {
	return renderSection({
		entry: (warning) => warning.mantlePath,
		groupKey: (warning) => warning.reason,
		title: "Deferred",
		warnings: warnings.filter(
			(warning): warning is Extract<MigrationWarning, { kind: "deferred" }> => {
				return warning.kind === "deferred";
			},
		),
	});
}

function renderInterpretive(warnings: ReadonlyArray<MigrationWarning>): string {
	return renderSection({
		entry: (warning) => `${warning.mantlePath} -> ${warning.bedrockPath}`,
		groupKey: (warning) => warning.rule,
		title: "Interpretive",
		warnings: warnings.filter(
			(warning): warning is Extract<MigrationWarning, { kind: "interpretive" }> => {
				return warning.kind === "interpretive";
			},
		),
	});
}
