import { describe, it } from "vitest";

import { evaluateGate, type GateInput } from "./gate.ts";

function observations(overrides: Partial<GateInput> = {}): GateInput {
	return {
		actual: undefined,
		affected: ["core"],
		covered: ["core"],
		desired: undefined,
		enforce: false,
		owned: true,
		renovate: true,
		review: [],
		selected: ["core"],
		...overrides,
	};
}

describe("intent gate", () => {
	it("should preserve coverage failures in shadow mode", ({ expect }) => {
		expect.hasAssertions();
		expect(evaluateGate(observations({ covered: [] })).errors).toStrictEqual([
			"No change intent covers: core",
		]);
	});

	it("should report semantic failures without changing shadow coverage", ({ expect }) => {
		expect.hasAssertions();

		const result = evaluateGate(
			observations({
				actual: "old",
				affected: [],
				desired: "new",
				owned: false,
				review: ["core: source edit"],
			}),
		);

		expect(result.errors).toStrictEqual([]);
		expect(result.diagnostics).toStrictEqual([
			"core: source edit",
			"pnpm and intent planner select different versioned packages",
			"Reserved intent has foreign ownership; move human edits to another intent filename",
			"Generated intent is missing, stale or obsolete",
		]);
	});

	it("should block unresolved review even without a generated file", ({ expect }) => {
		expect.hasAssertions();
		expect(
			evaluateGate(observations({ enforce: true, review: ["core: review compiler"] })).errors,
		).toStrictEqual(["core: review compiler"]);
	});

	it("should preserve human PR policy when enforcement is enabled", ({ expect }) => {
		expect.hasAssertions();
		expect(
			evaluateGate(
				observations({
					affected: [],
					desired: "new",
					enforce: true,
					owned: false,
					renovate: false,
					review: ["source"],
				}),
			),
		).toStrictEqual({ diagnostics: [], errors: [] });
	});

	it("should accept equivalent selected sets in any order", ({ expect }) => {
		expect.hasAssertions();
		expect(
			evaluateGate(
				observations({
					affected: ["actions", "core"],
					covered: ["actions", "core"],
					enforce: true,
					selected: ["core", "actions"],
				}),
			).errors,
		).toStrictEqual([]);
	});

	it("should block missing and obsolete files during enforcement", ({ expect }) => {
		expect.hasAssertions();

		const files = [
			{ actual: undefined, desired: "new" },
			{ actual: "old", desired: undefined },
		];
		const errors = files.map(
			(file) => evaluateGate(observations({ ...file, enforce: true })).errors,
		);

		expect(errors).toStrictEqual([
			["Generated intent is missing, stale or obsolete"],
			["Generated intent is missing, stale or obsolete"],
		]);
	});
});
