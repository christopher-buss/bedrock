import { describe, expect, it } from "vitest";

import type { MigrationReportFile, MigrationWarning } from "./migration-report.ts";
import { renderMigrationReportMarkdown } from "./render-migration-report-md.ts";

function fileWith(warnings: ReadonlyArray<MigrationWarning>): MigrationReportFile {
	return {
		summary: warnings.reduce(
			(accumulator, warning) => {
				return {
					...accumulator,
					[`${warning.kind}Count`]: accumulator[`${warning.kind}Count`] + 1,
				};
			},
			{ ambiguousCount: 0, blockedCount: 0, deferredCount: 0, interpretiveCount: 0 },
		),
		warnings,
	};
}

describe(renderMigrationReportMarkdown, () => {
	it("should always end with a trailing newline", () => {
		expect.assertions(1);

		expect(renderMigrationReportMarkdown(fileWith([]))).toEndWith("\n");
	});

	it("should render the count summary in the header for an empty report", () => {
		expect.assertions(1);

		const md = renderMigrationReportMarkdown(fileWith([]));

		expect(md).toBe(
			[
				"# Migration report",
				"",
				"ambiguous: 0",
				"blocked: 0",
				"deferred: 0",
				"interpretive: 0",
				"",
			].join("\n"),
		);
	});

	it("should render a single ambiguous warning with the env appended in parens", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "fix the path", kind: "ambiguous", mantlePath: "production.pass_x" },
			]),
		);

		expect(md).toContain("## Action required");
		expect(md).toContain("### fix the path");
		expect(md).toContain("- pass_x (production)");
	});

	it("should collapse the same suffix across envs into one bullet listing every env", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "missing icon", kind: "ambiguous", mantlePath: "development.pass_x" },
				{ hint: "missing icon", kind: "ambiguous", mantlePath: "production.pass_x" },
				{ hint: "missing icon", kind: "ambiguous", mantlePath: "staging.pass_x" },
			]),
		);

		const headings = md.match(/^### missing icon$/gm) ?? [];

		expect(headings).toHaveLength(1);
		expect(md).toContain("- pass_x (development, production, staging)");
		expect(md).not.toContain("- development.pass_x");
	});

	it("should list a strict subset of envs explicitly when only some envs share the suffix", () => {
		expect.assertions(1);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "missing icon", kind: "ambiguous", mantlePath: "production.pass_x" },
				{ hint: "missing icon", kind: "ambiguous", mantlePath: "staging.pass_x" },
			]),
		);

		expect(md).toContain("- pass_x (production, staging)");
	});

	it("should list distinct suffixes within one group as separate bullets", () => {
		expect.assertions(2);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "missing icon", kind: "ambiguous", mantlePath: "production.pass_x" },
				{ hint: "missing icon", kind: "ambiguous", mantlePath: "production.pass_y" },
			]),
		);

		expect(md).toContain("- pass_x (production)");
		expect(md).toContain("- pass_y (production)");
	});

	it("should render the full mantle-path and no parens when the path has no env prefix", () => {
		expect.assertions(2);

		const md = renderMigrationReportMarkdown(
			fileWith([{ hint: "h", kind: "ambiguous", mantlePath: "singleton" }]),
		);

		expect(md).toContain("- singleton");
		expect(md).not.toContain("- singleton (");
	});

	it("should preserve first-appearance env order within the bullet's parens", () => {
		expect.assertions(1);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "h", kind: "ambiguous", mantlePath: "staging.pass_x" },
				{ hint: "h", kind: "ambiguous", mantlePath: "development.pass_x" },
				{ hint: "h", kind: "ambiguous", mantlePath: "production.pass_x" },
			]),
		);

		expect(md).toContain("- pass_x (staging, development, production)");
	});

	it("should preserve first-appearance order for groups within a section", () => {
		expect.assertions(1);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "second", kind: "ambiguous", mantlePath: "production.a" },
				{ hint: "first", kind: "ambiguous", mantlePath: "production.b" },
				{ hint: "second", kind: "ambiguous", mantlePath: "production.c" },
			]),
		);

		expect(md.indexOf("### second")).toBeLessThan(md.indexOf("### first"));
	});

	it("should render blocked warnings under 'Won't migrate' grouped by reason", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ kind: "blocked", mantlePath: "production.x.genre", reason: "no equivalent" },
				{
					kind: "blocked",
					mantlePath: "production.x.permissions",
					reason: "no equivalent",
				},
				{
					kind: "blocked",
					mantlePath: "production.x.isArchived",
					reason: "different reason",
				},
			]),
		);

		expect(md).toContain("## Won't migrate (no Open Cloud equivalent)");
		expect(md).toContain("### no equivalent");
		expect(md).toContain("### different reason");
	});

	it("should render deferred warnings under 'Coming later' grouped by reason", () => {
		expect.assertions(2);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{
					kind: "deferred",
					mantlePath: "production.product_x",
					reason: "kind not yet supported",
				},
			]),
		);

		expect(md).toContain("## Coming later (skipped for now)");
		expect(md).toContain("### kind not yet supported");
	});

	it("should render interpretive warnings with arrow paths and the env in parens", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{
					bedrockPath: "universe.desktopEnabled",
					kind: "interpretive",
					mantlePath: "production.experienceConfiguration_singleton.playableDevices",
					rule: "list-to-flag",
				},
			]),
		);

		expect(md).toContain("## Auto-mapped (please verify)");
		expect(md).toContain("### list-to-flag");
		expect(md).toContain(
			"- experienceConfiguration_singleton.playableDevices -> universe.desktopEnabled (production)",
		);
	});

	it("should collapse interpretive entries by both mantle suffix and bedrock path", () => {
		expect.assertions(2);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{
					bedrockPath: "universe.desktopEnabled",
					kind: "interpretive",
					mantlePath: "development.experienceConfiguration_singleton.playableDevices",
					rule: "list-to-flag",
				},
				{
					bedrockPath: "universe.desktopEnabled",
					kind: "interpretive",
					mantlePath: "production.experienceConfiguration_singleton.playableDevices",
					rule: "list-to-flag",
				},
			]),
		);

		expect(md).toContain(
			"- experienceConfiguration_singleton.playableDevices -> universe.desktopEnabled (development, production)",
		);

		// Bullet should appear exactly once.
		const bullets = md.match(/^- experienceConfiguration_singleton/gm) ?? [];

		expect(bullets).toHaveLength(1);
	});

	it("should omit sections that have no matching warnings", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([{ kind: "blocked", mantlePath: "production.x", reason: "any" }]),
		);

		expect(md).not.toContain("## Action required");
		expect(md).not.toContain("## Coming later");
		expect(md).not.toContain("## Auto-mapped");
	});

	it("should order sections action-required, blocked, deferred, interpretive", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{
					bedrockPath: "u.x",
					kind: "interpretive",
					mantlePath: "production.x",
					rule: "r",
				},
				{ kind: "deferred", mantlePath: "production.y", reason: "later" },
				{ kind: "blocked", mantlePath: "production.z", reason: "no equivalent" },
				{ hint: "fix it", kind: "ambiguous", mantlePath: "production.q" },
			]),
		);

		expect(md.indexOf("## Action required")).toBeLessThan(md.indexOf("## Won't migrate"));
		expect(md.indexOf("## Won't migrate")).toBeLessThan(md.indexOf("## Coming later"));
		expect(md.indexOf("## Coming later")).toBeLessThan(md.indexOf("## Auto-mapped"));
	});

	it("should reflect the per-kind counts from the file summary in the header", () => {
		expect.assertions(4);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "h", kind: "ambiguous", mantlePath: "production.p1" },
				{ kind: "blocked", mantlePath: "production.p2", reason: "r" },
				{ kind: "deferred", mantlePath: "production.p3", reason: "r" },
				{
					bedrockPath: "b",
					kind: "interpretive",
					mantlePath: "production.p4",
					rule: "rule",
				},
			]),
		);

		expect(md).toContain("ambiguous: 1");
		expect(md).toContain("blocked: 1");
		expect(md).toContain("deferred: 1");
		expect(md).toContain("interpretive: 1");
	});

	it("should render a representative report exactly", () => {
		expect.assertions(1);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "missing icon", kind: "ambiguous", mantlePath: "development.pass_x" },
				{ hint: "missing icon", kind: "ambiguous", mantlePath: "production.pass_x" },
				{ kind: "blocked", mantlePath: "production.x.genre", reason: "no equivalent" },
				{ kind: "deferred", mantlePath: "production.y", reason: "kind not yet supported" },
				{
					bedrockPath: "universe.desktopEnabled",
					kind: "interpretive",
					mantlePath: "production.z.playableDevices",
					rule: "list-to-flag",
				},
			]),
		);

		expect(md).toBe(
			[
				"# Migration report",
				"",
				"ambiguous: 2",
				"blocked: 1",
				"deferred: 1",
				"interpretive: 1",
				"",
				"## Action required",
				"",
				"### missing icon",
				"",
				"- pass_x (development, production)",
				"",
				"## Won't migrate (no Open Cloud equivalent)",
				"",
				"### no equivalent",
				"",
				"- x.genre (production)",
				"",
				"## Coming later (skipped for now)",
				"",
				"### kind not yet supported",
				"",
				"- y (production)",
				"",
				"## Auto-mapped (please verify)",
				"",
				"### list-to-flag",
				"",
				"- z.playableDevices -> universe.desktopEnabled (production)",
				"",
			].join("\n"),
		);
	});

	it("should keep blocked warnings out of the action-required section", () => {
		expect.assertions(1);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "fix the path", kind: "ambiguous", mantlePath: "production.a" },
				{ kind: "blocked", mantlePath: "production.b", reason: "no equivalent" },
			]),
		);

		const actionStart = md.indexOf("## Action required");
		const blockedStart = md.indexOf("## Won't migrate");
		const actionRequiredBody = md.slice(actionStart, blockedStart);

		expect(actionRequiredBody).not.toContain("- b ");
	});

	it("should not double-count a path under both its group heading and a sibling group", () => {
		expect.assertions(2);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "first", kind: "ambiguous", mantlePath: "production.a" },
				{ hint: "second", kind: "ambiguous", mantlePath: "production.b" },
			]),
		);

		const firstGroup = md.slice(md.indexOf("### first"), md.indexOf("### second"));
		const secondGroup = md.slice(md.indexOf("### second"));

		expect(firstGroup).not.toContain("- b ");
		expect(secondGroup).not.toContain("- a ");
	});
});
