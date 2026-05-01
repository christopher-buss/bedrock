import { describe, expect, it } from "vitest";

import type { MigrationReportFile } from "./migration-report.ts";
import { serializeMigrationReport } from "./serialize-migration-report.ts";

const SAMPLE: MigrationReportFile = {
	summary: {
		ambiguousCount: 1,
		blockedCount: 1,
		deferredCount: 1,
		interpretiveCount: 1,
	},
	warnings: [
		{ hint: "fix the icon path", kind: "ambiguous", mantlePath: "production.pass_x" },
		{ kind: "blocked", mantlePath: "production.x.genre", reason: "no Open Cloud equivalent" },
		{ kind: "deferred", mantlePath: "production.y", reason: "kind not yet supported" },
		{
			bedrockPath: "universe.desktopEnabled",
			kind: "interpretive",
			mantlePath: "production.experienceConfiguration_singleton.playableDevices",
			rule: "list-to-flag",
		},
	],
};

describe(serializeMigrationReport, () => {
	it("should round-trip through JSON.parse to the original value", () => {
		expect.assertions(1);

		const serialized = serializeMigrationReport(SAMPLE);

		expect(JSON.parse(serialized)).toStrictEqual(SAMPLE);
	});

	it("should end with a trailing newline", () => {
		expect.assertions(1);

		expect(serializeMigrationReport(SAMPLE)).toEndWith("\n");
	});

	it("should pretty-print with two-space indentation so humans can skim it", () => {
		expect.assertions(1);

		expect(serializeMigrationReport(SAMPLE)).toContain('\n  "summary":');
	});

	it("should emit a stable byte-for-byte string given the same input", () => {
		expect.assertions(1);

		expect(serializeMigrationReport(SAMPLE)).toBe(serializeMigrationReport(SAMPLE));
	});

	it("should serialize an empty warning list with a zeroed summary", () => {
		expect.assertions(1);

		const empty: MigrationReportFile = {
			summary: {
				ambiguousCount: 0,
				blockedCount: 0,
				deferredCount: 0,
				interpretiveCount: 0,
			},
			warnings: [],
		};

		expect(JSON.parse(serializeMigrationReport(empty))).toStrictEqual(empty);
	});
});
