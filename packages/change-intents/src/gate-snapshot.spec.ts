import { describe, it } from "vitest";

import { validateGateSnapshot } from "./gate-snapshot.ts";

describe("gate snapshot", () => {
	it("should refuse an API snapshot that advanced after checkout", ({ expect }) => {
		expect.hasAssertions();
		expect(
			validateGateSnapshot(
				{
					actual: undefined,
					artifactsFailed: false,
					base: "new",
					head: "h",
					input: {
						base: { packages: {}, workspace: {} },
						head: { packages: {}, workspace: {} },
						humanIntents: [],
						number: 1,
						paths: [],
					},
					mergeParents: ["new", "h"],
					owned: true,
				},
				{ base: "b", head: "h", selected: [] },
			),
		).toStrictEqual([
			"PR snapshot advanced or merge parents differ; rerun the changeset check",
		]);
	});

	it("should accept an unchanged empty snapshot", ({ expect }) => {
		expect.hasAssertions();
		expect(
			validateGateSnapshot(
				{
					actual: undefined,
					artifactsFailed: false,
					base: "b",
					head: "h",
					input: {
						base: { packages: {}, workspace: {} },
						head: { packages: {}, workspace: {} },
						humanIntents: [],
						number: 1,
						paths: [],
					},
					mergeParents: ["b", "h"],
					owned: true,
				},
				{ base: "b", head: "h", selected: [] },
			),
		).toStrictEqual([]);
	});

	it("should report a failed Renovate artifact update", ({ expect }) => {
		expect.hasAssertions();
		expect(
			validateGateSnapshot(
				{
					actual: undefined,
					artifactsFailed: true,
					base: "b",
					head: "h",
					input: {
						base: { packages: {}, workspace: {} },
						head: { packages: {}, workspace: {} },
						humanIntents: [],
						number: 1,
						paths: [],
					},
					mergeParents: ["b", "h"],
					owned: true,
				},
				{ base: "b", head: "h", selected: [] },
			),
		).toStrictEqual(["Renovate artifact update failed; fix the branch before merging"]);
	});

	it("should reject a changed head and malformed merge parents independently", ({ expect }) => {
		expect.hasAssertions();

		const input = {
			base: { packages: {}, workspace: {} },
			head: { packages: {}, workspace: {} },
			humanIntents: [],
			number: 1,
			paths: [],
		};
		const states = [
			{
				actual: undefined,
				artifactsFailed: false,
				base: "b",
				head: "new",
				input,
				mergeParents: ["b", "new"],
				owned: true,
			},
			{
				actual: undefined,
				artifactsFailed: false,
				base: "b",
				head: "h",
				input,
				mergeParents: ["h", "b"],
				owned: true,
			},
		];
		const results = states.map((state) => {
			return validateGateSnapshot(state, { base: "b", head: "h", selected: [] });
		});

		expect(results).toStrictEqual([
			["PR snapshot advanced or merge parents differ; rerun the changeset check"],
			["PR snapshot advanced or merge parents differ; rerun the changeset check"],
		]);
	});

	it("should reject individually mismatched snapshot refs even when parents match", ({
		expect,
	}) => {
		expect.hasAssertions();

		const input = {
			base: { packages: {}, workspace: {} },
			head: { packages: {}, workspace: {} },
			humanIntents: [],
			number: 1,
			paths: [],
		};
		const states = [
			{
				actual: undefined,
				artifactsFailed: false,
				base: "new",
				head: "h",
				input,
				mergeParents: ["b", "h"],
				owned: true,
			},
			{
				actual: undefined,
				artifactsFailed: false,
				base: "b",
				head: "new",
				input,
				mergeParents: ["b", "h"],
				owned: true,
			},
		];
		const results = states.map((state) => {
			return validateGateSnapshot(state, { base: "b", head: "h", selected: [] });
		});

		expect(results).toStrictEqual([
			["PR snapshot advanced or merge parents differ; rerun the changeset check"],
			["PR snapshot advanced or merge parents differ; rerun the changeset check"],
		]);
	});

	it("should enforce writer provenance for matching refs without a generated file", ({
		expect,
	}) => {
		expect.hasAssertions();

		const input = {
			base: { packages: {}, workspace: {} },
			head: { packages: {}, workspace: {} },
			humanIntents: [],
			number: 1,
			paths: [],
		};
		const state = {
			actual: undefined,
			artifactsFailed: false,
			base: "b",
			head: "h",
			input,
			mergeParents: ["b", "h"],
			owned: false,
		};

		expect(validateGateSnapshot(state, { base: "b", head: "h", selected: [] })).toStrictEqual([
			"Reserved intent has foreign ownership; move human edits to another intent filename",
		]);
	});
});
