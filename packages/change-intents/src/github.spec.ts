// cspell:ignore Fref
import { describe, it, vi } from "vitest";

import { fixture, humanFixture, pull } from "../tests/github-fixture.spec.ts";
import { createGithubPort } from "./github.ts";

describe("gitHub change intents", () => {
	it.for([
		{ changed_files: 3001, commits: 1 },
		{ changed_files: 1, commits: 251 },
	])("should refuse PRs beyond complete REST enumeration limits", async (counts, { expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2"] = { ...pull, ...counts };

		await expect(port.read()).rejects.toThrow("REST enumeration limits");
	});

	it.for([
		{ context: "renovate/artifacts", expected: true, state: "failure" },
		{ context: "renovate/artifacts", expected: false, state: "success" },
		{ context: "renovate/stability-days", expected: false, state: "failure" },
	])(
		"should read artifact status from Renovate's latest commit, not the writer head",
		async ({ context, expected, state }, { expect }) => {
			expect.hasAssertions();

			const { port, responses } = fixture();
			responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [
				{ author: { login: "renovate[bot]" }, sha: "old" },
				{ author: { login: "renovate[bot]" }, sha: "renovate" },
				{ author: { login: "writer[bot]" }, sha: "writer" },
			];
			for (const sha of ["old", "renovate", "writer"]) {
				responses[`repos/owner/repo/commits/${sha}?per_page=100`] = { files: [] };
			}

			responses["repos/owner/repo/commits/old/status?per_page=100&page=1"] = {
				statuses: [{ context: "renovate/artifacts", state: "success" }],
			};
			responses["repos/owner/repo/commits/renovate/status?per_page=100&page=1"] = {
				statuses: [
					{ context: "renovate/stability-days", state: "success" },
					{ context, state },
				],
			};
			responses["repos/owner/repo/commits/writer/status?per_page=100&page=1"] = {
				statuses: [{ context: "renovate/artifacts", state: "failure" }],
			};

			await expect(port.read()).resolves.toHaveProperty("artifactsFailed", expected);
		},
	);

	it("should read later status pages before accepting an absent artifact status", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [
			{ author: { login: "renovate[bot]" }, sha: "renovate" },
		];
		responses["repos/owner/repo/commits/renovate?per_page=100"] = { files: [] };
		const unrelated = Array.from({ length: 100 }, (_, index) => {
			return { context: `other/${index}`, state: "success" };
		});
		for (let index = 1; index <= 9; index += 1) {
			responses[`repos/owner/repo/commits/renovate/status?per_page=100&page=${index}`] = {
				statuses: unrelated,
			};
		}

		responses["repos/owner/repo/commits/renovate/status?per_page=100&page=10"] = {
			statuses: [{ context: "renovate/artifacts", state: "failure" }],
		};

		await expect(port.read()).resolves.toHaveProperty("artifactsFailed", true);
	});

	it("should fail closed when status pagination cannot finish", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [
			{ author: { login: "renovate[bot]" }, sha: "renovate" },
		];
		responses["repos/owner/repo/commits/renovate?per_page=100"] = { files: [] };
		const page = {
			statuses: Array.from({ length: 100 }, () => ({ context: "other", state: "success" })),
		};
		for (let index = 1; index <= 10; index += 1) {
			responses[`repos/owner/repo/commits/renovate/status?per_page=100&page=${index}`] = page;
		}

		await expect(port.read()).rejects.toThrow("Commit status pagination exceeded safe limit");
	});

	it("should not report artifact failures without a Renovate commit", async ({ expect }) => {
		expect.hasAssertions();

		const { port } = fixture();

		await expect(port.read()).resolves.toHaveProperty("artifactsFailed", false);
	});

	it("should fail closed when commit-file pagination cannot finish", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/renovate-pr-2.md", status: "added" },
		];
		responses["repos/owner/repo/contents/.changeset/renovate-pr-2.md?ref=merge"] = {
			content: btoa("generated"),
			encoding: "base64",
		};
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [{ sha: "writer" }];
		const commit = { files: Array.from({ length: 100 }, () => ({ filename: "README.md" })) };
		responses["repos/owner/repo/commits/writer?per_page=100"] = commit;
		for (let page = 2; page <= 30; page += 1) {
			responses[`repos/owner/repo/commits/writer?per_page=100&page=${page}`] = commit;
		}

		await expect(port.read()).rejects.toThrow("Commit file pagination exceeded");
	});

	it("should refuse a reserved file when commit history does not explain it", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/renovate-pr-2.md", status: "added" },
		];
		responses["repos/owner/repo/contents/.changeset/renovate-pr-2.md?ref=merge"] = {
			content: btoa("generated"),
			encoding: "base64",
		};
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [{ sha: "writer" }];
		responses["repos/owner/repo/commits/writer?per_page=100"] = {
			files: [{ filename: "README.md" }],
		};
		const state = await port.read();

		expect(state.owned).toBe(false);
	});

	it("should encode file paths without allowing PR paths to alter the ref query", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/decision?ref=evil.md", status: "added" },
		];
		responses["repos/owner/repo/contents/.changeset/decision%3Fref%3Devil.md?ref=merge"] = {
			content: btoa("---\ncore: none\n---\nManual decision"),
			encoding: "base64",
		};
		const state = await port.read();

		expect(state.input.humanIntents).toStrictEqual([{ core: "none" }]);
	});

	it("should refuse reserved files when no commit proves their provenance", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/renovate-pr-2.md", status: "added" },
		];
		responses["repos/owner/repo/contents/.changeset/renovate-pr-2.md?ref=merge"] = {
			content: btoa("generated"),
			encoding: "base64",
		};
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [];
		const state = await port.read();

		expect(state.owned).toBe(false);
	});

	it("should inspect later commit-file pages before trusting reserved content", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/renovate-pr-2.md", status: "added" },
		];
		responses["repos/owner/repo/contents/.changeset/renovate-pr-2.md?ref=merge"] = {
			content: btoa("generated"),
			encoding: "base64",
		};
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [{ sha: "foreign" }];
		const commit = {
			commit: { verification: { verified: true } },
			committer: { login: "foreign" },
			files: Array.from({ length: 300 }, () => ({ filename: "README.md" })),
		};
		responses["repos/owner/repo/commits/foreign?per_page=100"] = commit;
		responses["repos/owner/repo/commits/foreign?per_page=100&page=2"] = {
			...commit,
			files: [{ filename: ".changeset/renovate-pr-2.md" }],
		};
		const state = await port.read();

		expect(state.owned).toBe(false);
	});

	it("should allow recovery by removing the reserved file and adding a human intent", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = humanFixture("---\ncore: none\n---\nManual decision");
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/renovate-pr-2.md", status: "removed" },
			{ filename: ".changeset/human.md", status: "added" },
		];
		const state = await port.read();

		expect(state.owned).toBe(true);
		expect(state.actual).toBeUndefined();
		expect(state.input.humanIntents).toStrictEqual([{ core: "none" }]);
	});

	it("should support the platform HTTP transport when none is injected", async ({ expect }) => {
		expect.hasAssertions();

		const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(pull));
		const port = createGithubPort({
			number: 2,
			repository: "owner/repo",
			token: "test",
			writerLogin: "writer[bot]",
		});

		const result = port.write({
			content: undefined,
			head: "old",
			path: ".changeset/renovate-pr-2.md",
		});
		request.mockRestore();

		await expect(result).rejects.toThrow("head changed");
	});

	it("should recognize verified writer commits touching the reserved path", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/renovate-pr-2.md", status: "added" },
		];
		responses["repos/owner/repo/contents/.changeset/renovate-pr-2.md?ref=merge"] = {
			content: btoa("generated"),
			encoding: "base64",
		};
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [{ sha: "writer" }];
		responses["repos/owner/repo/commits/writer?per_page=100"] = {
			author: { login: "writer[bot]" },
			commit: { verification: { reason: "valid", verified: true } },
			committer: { login: "web-flow" },
			files: [{ filename: ".changeset/renovate-pr-2.md" }],
		};
		const state = await port.read();

		expect(state.owned).toBe(true);
	});

	it.for([
		["missing frontmatter", "frontmatter"],
		["---\ncore: invalid\n---\n", "bump"],
	])("should fail malformed human intent %s", async ([body, error], { expect }) => {
		expect.hasAssertions();

		const { port } = humanFixture(String(body));

		await expect(port.read()).rejects.toThrow(error);
	});

	it("should reject unsupported content encodings", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/contents/pnpm-workspace.yaml?ref=base"] = {
			content: "packages: []",
			encoding: "utf8",
		};

		await expect(port.read()).rejects.toThrow("Unsupported content encoding");
	});

	it("should reject unsupported workspace globs rather than miss consumers", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/git/trees/base?recursive=1"] = {
			tree: [{ path: "packages/core/package.json", type: "blob" }],
			truncated: false,
		};
		responses["repos/owner/repo/contents/pnpm-workspace.yaml?ref=base"] = {
			content: btoa("packages: ['**']"),
			encoding: "base64",
		};

		await expect(port.read()).rejects.toThrow("Unsupported workspace pattern");
	});

	it("should read matching immutable base and merge snapshots", async ({ expect }) => {
		expect.hasAssertions();

		const { port } = fixture();
		const state = await port.read();

		expect(state.base).toBe("base");
		expect(state.head).toBe("head");
		expect(state.input.paths).toStrictEqual([]);
		expect(state.owned).toBe(true);
	});

	it("should append additions with an expected head and the reserved file", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, requests } = fixture();
		await port.write({ content: "intent", head: "head", path: ".changeset/renovate-pr-2.md" });

		expect(requests.at(-1)!.body).toContain('"expectedHeadOid":"head"');
		expect(requests.at(-1)!.body).toContain('"contents":"aW50ZW50"');
	});

	it("should delete obsolete generated intent files conditionally", async ({ expect }) => {
		expect.hasAssertions();

		const { port, requests } = fixture();
		await port.write({ content: undefined, head: "head", path: ".changeset/renovate-pr-2.md" });

		expect(requests.at(-1)!.body).toContain(
			'"deletions":[{"path":".changeset/renovate-pr-2.md"}]',
		);
	});

	it("should reject writes after a changed head", async ({ expect }) => {
		expect.hasAssertions();

		const { port } = fixture();

		await expect(
			port.write({ content: "intent", head: "old", path: ".changeset/renovate-pr-2.md" }),
		).rejects.toThrow("head changed");
	});

	it("should fail GraphQL errors instead of reporting success", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["graphql"] = { errors: [{ message: "head mismatch" }] };

		await expect(
			port.write({ content: "intent", head: "head", path: ".changeset/renovate-pr-2.md" }),
		).rejects.toThrow("head mismatch");
	});

	it("should reject stale test merges", async ({ expect, onTestFinished }) => {
		expect.hasAssertions();

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});

		const { port, responses } = fixture();
		responses["repos/owner/repo/commits/merge"] = {
			parents: [{ sha: "old" }, { sha: "head" }],
		};

		const checked = port.read().catch((err) => err);
		await vi.runAllTimersAsync();

		await expect(checked).resolves.toMatchObject({ message: "GitHub test merge is stale" });
	});

	it("should reject unavailable merges", async ({ expect, onTestFinished }) => {
		expect.hasAssertions();

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2"] = { ...pull, merge_commit_sha: JSON.parse("null") };

		const checked = port.read().catch((err) => err);
		await vi.runAllTimersAsync();

		await expect(checked).resolves.toMatchObject({
			message: "GitHub has no test merge; retry later",
		});
	});

	it("should fail incomplete recursive trees", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/git/trees/base?recursive=1"] = { tree: [], truncated: true };

		await expect(port.read()).rejects.toThrow("truncated");
	});

	it("should reject missing contents rather than omitting packages", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		delete responses["repos/owner/repo/contents/pnpm-workspace.yaml?ref=base"];

		await expect(port.read()).rejects.toThrow("404");
	});

	it("should reject unsigned edits to the reserved intent", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/renovate-pr-2.md", status: "added" },
		];
		responses["repos/owner/repo/contents/.changeset/renovate-pr-2.md?ref=merge"] = {
			content: btoa("generated"),
			encoding: "base64",
		};
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [{ sha: "writer" }];
		responses["repos/owner/repo/commits/writer?per_page=100"] = {
			commit: { verification: { verified: false } },
			committer: { login: "writer[bot]" },
			files: [{ filename: ".changeset/renovate-pr-2.md" }],
		};

		const state = await port.read();

		expect(state.owned).toBe(false);
	});

	it("should read structured workspace manifests and human coverage at the merge SHA", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		for (const sha of ["base", "merge"]) {
			responses[`repos/owner/repo/git/trees/${sha}?recursive=1`] = {
				tree: [{ path: "packages/core/package.json", type: "blob" }],
				truncated: false,
			};
			responses[`repos/owner/repo/contents/pnpm-workspace.yaml?ref=${sha}`] = {
				content: btoa("packages: ['packages/*']"),
				encoding: "base64",
			};
			responses[`repos/owner/repo/contents/packages/core/package.json?ref=${sha}`] = {
				content: btoa('{"name":"core","version":"0.1.0"}'),
				encoding: "base64",
			};
		}

		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/human.md", status: "added" },
		];
		responses["repos/owner/repo/contents/.changeset/human.md?ref=merge"] = {
			content: btoa("---\n'core': none\n---\nManual decision"),
			encoding: "base64",
		};
		const state = await port.read();

		expect(state.input.head.packages["packages/core"]!.name).toBe("core");
		expect(state.input.humanIntents).toStrictEqual([{ core: "none" }]);
	});

	it("should reject a PR from a fork before reading its files", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2"] = {
			...pull,
			head: { ...pull.head, repo: { full_name: "fork/repo" } },
		};

		await expect(port.read()).rejects.toThrow("same-repository Renovate");
	});
});
