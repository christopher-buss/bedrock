import { describe, it } from "vitest";

import { reconcileAsync } from "./reconcile.ts";
import type { IntentWrite, ReconcileState } from "./reconcile.ts";

function fixture() {
	const state: ReconcileState = {
		actual: undefined,
		artifactsFailed: false,
		base: "base",
		head: "head",
		input: {
			base: {
				packages: {
					"packages/core": {
						name: "core",
						dependencies: { arktype: "2.2.8" },
						version: "0.1.0",
					},
				},
				workspace: {},
			},
			head: {
				packages: {
					"packages/core": {
						name: "core",
						dependencies: { arktype: "2.2.9" },
						version: "0.1.0",
					},
				},
				workspace: {},
			},
			humanIntents: [],
			number: 2,
			paths: ["packages/core/package.json"],
		},
		mergeParents: ["base", "head"],
		owned: true,
	};
	const writes: Array<IntentWrite> = [];
	return {
		port: {
			read: async () => state,
			write: async (change: IntentWrite) => {
				writes.push(change);
			},
		},
		state,
		writes,
	};
}

function advancingPort(state: ReconcileState, writes: Array<IntentWrite>) {
	let first = true;
	return {
		read: async () => {
			const head = first ? "head" : "new-head";
			first = false;
			const input = structuredClone(state.input);
			input.head.packages["packages/core"]!.dependencies = {
				arktype: head === "head" ? "2.2.9" : "2.2.10",
			};
			return { ...state, head, input, mergeParents: ["base", head] };
		},
		write: async (change: IntentWrite) => {
			writes.push(change);
		},
	};
}

describe("intent reconciliation", () => {
	it.for([
		["base", "head", "extra"],
		["base", "old"],
	])("should reject malformed merge parents independently", async (parents, { expect }) => {
		expect.hasAssertions();

		const { port, state } = fixture();
		state.mergeParents = parents;

		await expect(reconcileAsync(port, true)).rejects.toThrow(
			"Test merge is unavailable or stale",
		);
	});

	it("should separate multiple release-policy diagnostics", async ({ expect }) => {
		expect.hasAssertions();

		const { port, state } = fixture();
		state.input.paths.push("packages/core/src/index.ts");
		state.input.head.packages = {
			"packages/core": { name: "core", dependencies: { arktype: "3.0.0" }, version: "0.1.0" },
		};

		await expect(reconcileAsync(port, true)).rejects.toThrow(
			"core: review source changes\ncore: review arktype",
		);
	});

	it("should discard a calculation when only the head advances", async ({ expect }) => {
		expect.hasAssertions();

		const { state, writes } = fixture();
		const port = advancingPort(state, writes);
		await reconcileAsync(port, true);

		expect(writes).toHaveLength(1);
		expect(writes.at(0)!.head).toBe("new-head");
		expect(writes.at(0)!.content).toContain("arktype: 2.2.8 → 2.2.10");
	});

	it("should avoid writing when no versioned package changes", async ({ expect }) => {
		expect.hasAssertions();

		const writes: Array<object> = [];
		const state = {
			actual: undefined,
			artifactsFailed: false,
			base: "base",
			head: "head",
			input: {
				base: { packages: {}, workspace: {} },
				head: { packages: {}, workspace: {} },
				humanIntents: [],
				number: 2,
				paths: [],
			},
			mergeParents: ["base", "head"],
			owned: true,
		};
		const result = await reconcileAsync(
			{
				read: async () => state,
				write: async (change) => {
					writes.push(change);
				},
			},
			false,
		);

		expect(result.kind).toBe("unchanged");
		expect(writes).toStrictEqual([]);
	});

	it("should condition a generated addition on the observed head", async ({ expect }) => {
		expect.hasAssertions();

		const { port, writes } = fixture();
		const result = await reconcileAsync(port, true);

		expect(result.kind).toBe("written");
		expect(writes).toStrictEqual([
			{
				content:
					'---\n"core": patch\n---\n\nUpdate dependencies:\n- arktype: 2.2.8 → 2.2.9\n',
				head: "head",
				path: ".changeset/renovate-pr-2.md",
			},
		]);
	});

	it("should report proposed bytes without writing in shadow mode", async ({ expect }) => {
		expect.hasAssertions();

		const { port, writes } = fixture();

		const result = await reconcileAsync(port, false);

		expect(result.kind).toBe("proposed");
		expect(writes).toStrictEqual([]);
	});

	it("should block foreign-owned edits", async ({ expect }) => {
		expect.hasAssertions();

		const { port, state, writes } = fixture();
		state.owned = false;

		await expect(reconcileAsync(port, true)).rejects.toThrow("Reserved intent edited");
		expect(writes).toStrictEqual([]);
	});

	it("should block a stale merge snapshot", async ({ expect }) => {
		expect.hasAssertions();

		const { port, state } = fixture();
		state.mergeParents = ["old", "head"];

		await expect(reconcileAsync(port, true)).rejects.toThrow("Test merge");
	});

	it("should fail before writing when source changes require review", async ({ expect }) => {
		expect.hasAssertions();

		const { port, state, writes } = fixture();
		state.input.paths.push("packages/core/src/index.ts");

		await expect(reconcileAsync(port, true)).rejects.toThrow("review source changes");
		expect(writes).toStrictEqual([]);
	});

	it("should bound retries when the base keeps advancing", async ({ expect }) => {
		expect.hasAssertions();

		const { state, writes } = fixture();
		let reads = 0;

		await expect(
			reconcileAsync(
				{
					read: async () => {
						reads += 1;
						return {
							...state,
							base: String(reads),
							mergeParents: [String(reads), "head"],
						};
					},
					write: async (change) => {
						writes.push(change);
					},
				},
				true,
			),
		).rejects.toThrow("refs keep changing");
		expect(reads).toBe(6);
		expect(writes).toStrictEqual([]);
	});
});
