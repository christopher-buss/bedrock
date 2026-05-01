import type { MigrationReportFile, MigrationWarning } from "./migration-report.ts";

interface SectionInput<W extends { readonly mantlePath: string }> {
	readonly groupKey: (warning: W) => string;
	/**
	 * Subject the entry collapses by. For ambiguous/blocked/deferred this is
	 * the mantle-path suffix (env stripped); for interpretive it is suffix
	 * plus `-> bedrockPath` so distinct mappings remain distinct bullets.
	 */
	readonly subject: (warning: W) => string;
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

function suffixOf(mantlePath: string): string {
	// `indexOf(".") === -1` becomes `slice(0)` so no branch is needed.
	return mantlePath.slice(mantlePath.indexOf(".") + 1);
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

function environmentOf(mantlePath: string): string | undefined {
	const dot = mantlePath.indexOf(".");
	return dot === -1 ? undefined : mantlePath.slice(0, dot);
}

function environmentsOf(
	members: ReadonlyArray<{ readonly mantlePath: string }>,
): ReadonlyArray<string> {
	const environments = members
		.map((warning) => environmentOf(warning.mantlePath))
		.filter((environment): environment is string => environment !== undefined);
	return [...new Set(environments)];
}

function renderBullet(
	subject: string,
	members: ReadonlyArray<{ readonly mantlePath: string }>,
): string {
	const environments = environmentsOf(members);
	return environments.length === 0 ? `- ${subject}` : `- ${subject} (${environments.join(", ")})`;
}

function renderSection<W extends { readonly mantlePath: string }>(input: SectionInput<W>): string {
	if (input.warnings.length === 0) {
		return "";
	}

	const groups = groupByKey(input.warnings, input.groupKey);
	const blocks = [...groups].map(([heading, members]) => {
		const bySubject = groupByKey(members, input.subject);
		const lines = [...bySubject].map(([key, subjectMembers]) =>
			renderBullet(key, subjectMembers),
		);
		return [`### ${heading}`, "", ...lines, ""].join("\n");
	});

	return [`## ${input.title}`, "", ...blocks].join("\n");
}

function renderActionRequired(warnings: ReadonlyArray<MigrationWarning>): string {
	return renderSection({
		groupKey: (warning) => warning.hint,
		subject: (warning) => suffixOf(warning.mantlePath),
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
		groupKey: (warning) => warning.reason,
		subject: (warning) => suffixOf(warning.mantlePath),
		title: "Won't migrate (no Open Cloud equivalent)",
		warnings: warnings.filter(
			(warning): warning is Extract<MigrationWarning, { kind: "blocked" }> => {
				return warning.kind === "blocked";
			},
		),
	});
}

function renderDeferred(warnings: ReadonlyArray<MigrationWarning>): string {
	return renderSection({
		groupKey: (warning) => warning.reason,
		subject: (warning) => suffixOf(warning.mantlePath),
		title: "Coming later (skipped for now)",
		warnings: warnings.filter(
			(warning): warning is Extract<MigrationWarning, { kind: "deferred" }> => {
				return warning.kind === "deferred";
			},
		),
	});
}

function renderInterpretive(warnings: ReadonlyArray<MigrationWarning>): string {
	return renderSection({
		groupKey: (warning) => warning.rule,
		subject: (warning) => `${suffixOf(warning.mantlePath)} -> ${warning.bedrockPath}`,
		title: "Auto-mapped (please verify)",
		warnings: warnings.filter(
			(warning): warning is Extract<MigrationWarning, { kind: "interpretive" }> => {
				return warning.kind === "interpretive";
			},
		),
	});
}
