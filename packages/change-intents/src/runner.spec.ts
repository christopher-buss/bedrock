import { describe, it } from "vitest";

import { runGateAsync, runWriterAsync } from "./runner.ts";

describe("runner", () => {
	it("should reject invalid writer numbers before any API call", async ({ expect }) => {
		expect.hasAssertions();
		await expect(
			runWriterAsync({ PR_NUMBER: "0", WRITER_LOGIN: "writer" }, () => {
				throw new Error("unexpected API");
			}),
		).rejects.toThrow("Invalid PR_NUMBER");
	});

	it.for([
		["shadow", 0],
		["enforce", 1],
		["write", 1],
		[undefined, 0],
	] as const)(
		"should enforce semantic failures only in enabled modes",
		async ([mode, code], { expect }) => {
			expect.hasAssertions();

			const state = {
				actual: "stale",
				base: "b",
				head: "h",
				input: {
					base: { packages: {}, workspace: {} },
					head: { packages: {}, workspace: {} },
					humanIntents: [],
					number: 2,
					paths: [],
				},
				mergeParents: ["b", "h"],
				owned: true,
			};
			const result = await runGateAsync({
				args: [],
				env: {
					CHECKOUT_BASE: "b",
					CHECKOUT_HEAD: "h",
					GH_TOKEN: "token",
					GITHUB_REPOSITORY: "o/r",
					INTENTS_MODE: mode,
					PR_NUMBER: "2",
					WRITER_LOGIN: undefined,
				},
				factory: (received) => {
					expect(received.writerLogin).toBe("");

					return {
						read: async () => state,
						write: async () => {
							throw new Error("unexpected write");
						},
					};
				},
				local: { command: () => "[]", read: () => "{}", root: "." },
			});

			expect(result.code).toBe(code);
			expect(result.output).toContain("Generated intent is missing, stale or obsolete");
		},
	);

	it("should print scope without needing GitHub credentials", async ({ expect }) => {
		expect.hasAssertions();

		const result = await runGateAsync({
			args: ["--scope"],
			env: {},
			factory: () => {
				throw new Error("unexpected API");
			},
			local: { command: () => "[]", read: () => "{}", root: "." },
		});

		expect(result).toStrictEqual({ code: 0, output: "" });
	});

	it("should report missing credentials before requesting GitHub", async ({ expect }) => {
		expect.hasAssertions();
		await expect(
			runWriterAsync({}, () => {
				throw new Error("unexpected API");
			}),
		).rejects.toThrow("Missing WRITER_LOGIN");
	});

	it("should write a valid PR-one intent with complete validated credentials", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const writes: Array<string | undefined> = [];
		const state = {
			actual: "old",
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
		const output = await runWriterAsync(
			{
				GH_TOKEN: "token",
				GITHUB_REPOSITORY: "o/r",
				PR_NUMBER: "1",
				WRITER_LOGIN: "writer[bot]",
			},
			(received) => {
				expect(received).toStrictEqual({
					number: 1,
					repository: "o/r",
					token: "token",
					writerLogin: "writer[bot]",
				});

				return {
					read: async () => state,
					write: async (change) => {
						writes.push(change.content);
					},
				};
			},
		);

		expect(writes).toStrictEqual([undefined]);
		expect(output).toContain('"kind":"written"');
	});

	it("should join multiple versioned package names in scope output", async ({ expect }) => {
		expect.hasAssertions();

		const data: Record<string, string> = {
			"/repo/a/package.json": '{"name":"a","version":"1.0.0"}',
			"/repo/b/package.json": '{"name":"b","version":"1.0.0"}',
			"pnpm-workspace.yaml": "{}",
		};
		const result = await runGateAsync({
			args: ["--scope"],
			env: {},
			factory: () => {
				throw new Error("Unexpected API");
			},
			local: {
				command: () => JSON.stringify([{ path: "/repo/a" }, { path: "/repo/b" }]),
				read: (path) => data[path.replaceAll("\\", "/")]!,
				root: "/repo",
			},
		});

		expect(result).toStrictEqual({ code: 0, output: "a\nb" });
	});

	it("should pass enforcement when the tested snapshot needs no generated intent", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const state = {
			actual: undefined,
			base: "b",
			head: "h",
			input: {
				base: { packages: {}, workspace: {} },
				head: { packages: {}, workspace: {} },
				humanIntents: [],
				number: 2,
				paths: [],
			},
			mergeParents: ["b", "h"],
			owned: true,
		};
		const result = await runGateAsync({
			args: [],
			env: {
				CHECKOUT_BASE: "b",
				CHECKOUT_HEAD: "h",
				GH_TOKEN: "t",
				GITHUB_REPOSITORY: "o/r",
				INTENTS_MODE: "enforce",
				PR_NUMBER: "2",
			},
			factory: () => {
				return {
					read: async () => state,
					write: async () => {
						throw new Error("unexpected write");
					},
				};
			},
			local: { command: () => "[]", read: () => "{}", root: "." },
		});

		expect(result.code).toBe(0);
		expect(result.output).toContain('"diagnostics": []');
	});

	it("should reject empty required environment values", async ({ expect }) => {
		expect.hasAssertions();
		await expect(
			runWriterAsync({ PR_NUMBER: "1", WRITER_LOGIN: "" }, () => {
				throw new Error("unexpected API");
			}),
		).rejects.toThrow("Missing WRITER_LOGIN");
	});
});
