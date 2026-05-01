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

	it("should render a single ambiguous warning under Action required with hint as heading", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "fix the path", kind: "ambiguous", mantlePath: "production.pass_x" },
			]),
		);

		expect(md).toContain("## Action required");
		expect(md).toContain("### fix the path");
		expect(md).toContain("- production.pass_x");
	});

	it("should group ambiguous warnings sharing a hint under one heading", () => {
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
		expect(md).toContain("- development.pass_x");
		expect(md).toContain("- staging.pass_x");
	});

	it("should preserve first-appearance order for groups within a section", () => {
		expect.assertions(1);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "second", kind: "ambiguous", mantlePath: "a" },
				{ hint: "first", kind: "ambiguous", mantlePath: "b" },
				{ hint: "second", kind: "ambiguous", mantlePath: "c" },
			]),
		);

		expect(md.indexOf("### second")).toBeLessThan(md.indexOf("### first"));
	});

	it("should render blocked warnings under 'Won't migrate' grouped by reason", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ kind: "blocked", mantlePath: "p.x", reason: "no equivalent" },
				{ kind: "blocked", mantlePath: "p.y", reason: "no equivalent" },
				{ kind: "blocked", mantlePath: "p.z", reason: "different reason" },
			]),
		);

		expect(md).toContain("## Won't migrate (no Open Cloud equivalent)");
		expect(md).toContain("### no equivalent");
		expect(md).toContain("### different reason");
	});

	it("should render deferred warnings under 'Coming later' grouped by reason", () => {
		expect.assertions(2);

		const md = renderMigrationReportMarkdown(
			fileWith([{ kind: "deferred", mantlePath: "p.x", reason: "kind not yet supported" }]),
		);

		expect(md).toContain("## Coming later (skipped for now)");
		expect(md).toContain("### kind not yet supported");
	});

	it("should render interpretive warnings under 'Auto-mapped' grouped by rule with arrow paths", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{
					bedrockPath: "universe.desktopEnabled",
					kind: "interpretive",
					mantlePath: "p.experienceConfiguration_singleton.playableDevices",
					rule: "list-to-flag",
				},
			]),
		);

		expect(md).toContain("## Auto-mapped (please verify)");
		expect(md).toContain("### list-to-flag");
		expect(md).toContain(
			"- p.experienceConfiguration_singleton.playableDevices -> universe.desktopEnabled",
		);
	});

	it("should omit sections that have no matching warnings", () => {
		expect.assertions(3);

		const md = renderMigrationReportMarkdown(
			fileWith([{ kind: "blocked", mantlePath: "p.x", reason: "any" }]),
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
					mantlePath: "p.x",
					rule: "r",
				},
				{ kind: "deferred", mantlePath: "p.y", reason: "later" },
				{ kind: "blocked", mantlePath: "p.z", reason: "no equivalent" },
				{ hint: "fix it", kind: "ambiguous", mantlePath: "p.q" },
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
				{ hint: "h", kind: "ambiguous", mantlePath: "p1" },
				{ kind: "blocked", mantlePath: "p2", reason: "r" },
				{ kind: "deferred", mantlePath: "p3", reason: "r" },
				{ bedrockPath: "b", kind: "interpretive", mantlePath: "p4", rule: "rule" },
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
				"- development.pass_x",
				"- production.pass_x",
				"",
				"## Won't migrate (no Open Cloud equivalent)",
				"",
				"### no equivalent",
				"",
				"- production.x.genre",
				"",
				"## Coming later (skipped for now)",
				"",
				"### kind not yet supported",
				"",
				"- production.y",
				"",
				"## Auto-mapped (please verify)",
				"",
				"### list-to-flag",
				"",
				"- production.z.playableDevices -> universe.desktopEnabled",
				"",
			].join("\n"),
		);
	});

	it("should keep blocked warnings out of the action-required section", () => {
		expect.assertions(1);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "fix the path", kind: "ambiguous", mantlePath: "p.a" },
				{ kind: "blocked", mantlePath: "p.b", reason: "no equivalent" },
			]),
		);

		const actionStart = md.indexOf("## Action required");
		const blockedStart = md.indexOf("## Won't migrate");
		const actionRequiredBody = md.slice(actionStart, blockedStart);

		expect(actionRequiredBody).not.toContain("- p.b");
	});

	it("should not double-count a path under both its group heading and a sibling group", () => {
		expect.assertions(2);

		const md = renderMigrationReportMarkdown(
			fileWith([
				{ hint: "first", kind: "ambiguous", mantlePath: "p.a" },
				{ hint: "second", kind: "ambiguous", mantlePath: "p.b" },
			]),
		);

		const firstGroup = md.slice(md.indexOf("### first"), md.indexOf("### second"));
		const secondGroup = md.slice(md.indexOf("### second"));

		expect(firstGroup).not.toContain("- p.b");
		expect(secondGroup).not.toContain("- p.a");
	});
});
