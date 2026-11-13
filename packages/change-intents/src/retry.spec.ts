import { describe, it } from "vitest";

import { HeadChangedError, reconcileAsync } from "./reconcile.ts";
import type { ReconcileState } from "./reconcile.ts";

describe("retry", () => {
	it("should retry only conditional head conflicts", async ({ expect }) => {
		expect.hasAssertions();

		const state: ReconcileState = {
			actual: "old",
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
		};
		let attempts = 0;

		await expect(
			reconcileAsync(
				{
					read: async () => state,
					write: async () => {
						attempts += 1;
						await [
							async () => {
								throw new HeadChangedError();
							},
							async () => {},
						][attempts - 1]!();
					},
				},
				true,
			),
		).resolves.toMatchObject({ kind: "written" });
		expect(attempts).toBe(2);
	});

	it("should propagate unrelated write failures without retrying", async ({ expect }) => {
		expect.hasAssertions();

		let reads = 0;
		const state = {
			actual: "old",
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
		};

		await expect(
			reconcileAsync(
				{
					read: async () => {
						reads += 1;
						return state;
					},
					write: async () => {
						throw new Error("permission denied");
					},
				},
				true,
			),
		).rejects.toThrow("permission denied");
		expect(reads).toBe(2);
	});

	it("should exhaust repeated conditional races after three attempts", async ({ expect }) => {
		expect.hasAssertions();

		let writes = 0;
		const state = {
			actual: "old",
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
		};

		await expect(
			reconcileAsync(
				{
					read: async () => state,
					write: async () => {
						writes += 1;
						throw new HeadChangedError();
					},
				},
				true,
			),
		).rejects.toThrow("PR refs keep changing; dispatch the writer again");
		expect(writes).toBe(3);
	});
});
