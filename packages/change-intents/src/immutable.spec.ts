import { describe, it } from "vitest";

import { fixture, humanFixture } from "../tests/github-fixture.spec.ts";
import { HeadChangedError } from "./reconcile.ts";

describe("immutable", () => {
	it("should derive changed paths from immutable blob identities", async ({ expect }) => {
		expect.hasAssertions();

		const { port, requests, responses } = fixture();
		responses["repos/owner/repo/git/trees/base?recursive=1"] = {
			tree: [{ path: "source.ts", sha: "old", type: "blob" }],
			truncated: false,
		};
		responses["repos/owner/repo/git/trees/merge?recursive=1"] = {
			tree: [{ path: "source.ts", sha: "new", type: "blob" }],
			truncated: false,
		};

		const result = await port.read();

		expect(result.input.paths).toStrictEqual(["source.ts"]);
		expect(requests.some(({ path }) => path.includes("/pulls/2/files"))).toBe(false);
	});

	it("should inspect a human deletion even when the reserved path vanished from the net diff", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, requests, responses } = fixture();
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [
			{ sha: "human-delete" },
		];
		responses["repos/owner/repo/commits/human-delete"] = {
			author: { login: "human" },
			commit: { verification: { reason: "valid", verified: true } },
			committer: { login: "web-flow" },
			files: [{ filename: ".changeset/renovate-pr-2.md" }],
		};
		const state = await port.read();

		expect(state.owned).toBe(false);
		expect(requests.map(({ path }) => path)).toContain(
			"repos/owner/repo/compare/base...head?per_page=100&page=1",
		);
	});

	it("should permit a complete explicit human-file handoff after deletion", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = humanFixture("---\ncore: none\n---\nManual intent");
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [
			{ sha: "human-delete" },
		];
		responses["repos/owner/repo/commits/human-delete"] = {
			author: { login: "human" },
			commit: { verification: { reason: "valid", verified: true } },
			committer: { login: "web-flow" },
			files: [{ filename: ".changeset/renovate-pr-2.md" }],
		};
		const state = await port.read();

		expect(state.owned).toBe(true);
		expect(state.input.humanIntents).toStrictEqual([{ core: "none" }]);
	});

	it("should map expected-head GraphQL rejection into a retryable race", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["graphql"] = {
			errors: [
				{
					message:
						'Expected branch to point to "old" but it did not. Pull and try again.',
					path: ["createCommitOnBranch"],
					type: "STALE_DATA",
				},
			],
		};

		await expect(
			port.write({ content: "intent", head: "head", path: ".changeset/renovate-pr-2.md" }),
		).rejects.toBeInstanceOf(HeadChangedError);
	});

	it("should bound immutable history pagination", async ({ expect }) => {
		expect.hasAssertions();

		const { port, requests, responses } = fixture();
		for (let page = 1; page <= 100; page += 1) {
			responses[`repos/owner/repo/pulls/2/commits?per_page=100&page=${page}`] = Array.from(
				{ length: 100 },
				() => ({ sha: "commit" }),
			);
		}

		await expect(port.read()).rejects.toThrow("GitHub pagination exceeded safe limit");
		expect(requests.filter(({ path }) => path.includes("/compare/"))).toHaveLength(100);
	});

	it("should reject a partial human handoff that does not cover affected consumers", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = humanFixture("---\nother: none\n---\nOther package only");
		for (const revision of ["base", "merge"]) {
			responses[`repos/owner/repo/contents/pnpm-workspace.yaml?ref=${revision}`] = {
				content: btoa("packages: [packages/*]"),
				encoding: "base64",
			};
			responses[`repos/owner/repo/git/trees/${revision}?recursive=1`] = {
				tree: [{ path: "packages/core/package.json", type: "blob" }],
				truncated: false,
			};
		}

		responses["repos/owner/repo/contents/packages/core/package.json?ref=base"] = {
			content: btoa('{"name":"core","version":"0.1.0","dependencies":{"arktype":"2.2.8"}}'),
			encoding: "base64",
		};
		responses["repos/owner/repo/contents/packages/core/package.json?ref=merge"] = {
			content: btoa('{"name":"core","version":"0.1.0","dependencies":{"arktype":"2.2.9"}}'),
			encoding: "base64",
		};
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [
			{ sha: "human-delete" },
		];
		responses["repos/owner/repo/commits/human-delete"] = {
			author: { login: "human" },
			commit: { verification: { reason: "valid", verified: true } },
			committer: { login: "web-flow" },
			files: [{ filename: ".changeset/renovate-pr-2.md" }],
		};
		const state = await port.read();

		expect(state.owned).toBe(false);
		expect(state.input.humanIntents).toStrictEqual([{ other: "none" }]);
	});

	it("should propagate expected-head argument validation errors without retry classification", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["graphql"] = { errors: [{ message: "Invalid value for expectedHeadOid" }] };
		const failure = port.write({
			content: "intent",
			head: "head",
			path: ".changeset/renovate-pr-2.md",
		});

		await expect(failure).rejects.toThrow("Invalid value for expectedHeadOid");
		await expect(failure).rejects.not.toBeInstanceOf(HeadChangedError);
	});

	it.for([
		{ message: "Stale unrelated data", path: ["otherMutation"], type: "STALE_DATA" },
		{ message: "Stale unrelated data", type: "STALE_DATA" },
	])("should not retry stale data from unrelated mutation paths", async (error, { expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["graphql"] = { errors: [error] };
		const failure = port.write({
			content: "intent",
			head: "head",
			path: ".changeset/renovate-pr-2.md",
		});

		await expect(failure).rejects.toThrow("Stale unrelated data");
		await expect(failure).rejects.not.toBeInstanceOf(HeadChangedError);
	});

	it("should enumerate only changed blobs and ignore changed subtrees", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/git/trees/base?recursive=1"] = {
			tree: [
				{ path: "README.md", sha: "same", type: "blob" },
				{ path: "modified.ts", sha: "old", type: "blob" },
				{ path: "removed.ts", sha: "gone", type: "blob" },
				{ path: ".changeset/deleted.md", sha: "old-intent", type: "blob" },
				{ path: "directory", sha: "old-tree", type: "tree" },
			],
			truncated: false,
		};
		responses["repos/owner/repo/git/trees/merge?recursive=1"] = {
			tree: [
				{ path: "README.md", sha: "same", type: "blob" },
				{ path: "modified.ts", sha: "new", type: "blob" },
				{ path: "added.ts", sha: "added", type: "blob" },
				{ path: "directory", sha: "new-tree", type: "tree" },
			],
			truncated: false,
		};
		const state = await port.read();

		expect(state.input.paths).toStrictEqual([
			"modified.ts",
			"removed.ts",
			".changeset/deleted.md",
			"added.ts",
		]);
		expect(state.input.humanIntents).toStrictEqual([]);
	});

	it.for([
		[],
		[
			{ message: "Expected stale", path: ["createCommitOnBranch"], type: "STALE_DATA" },
			{ message: "Denied", path: ["createCommitOnBranch"], type: "FORBIDDEN" },
		],
		[{ message: "Denied", path: ["createCommitOnBranch"], type: "FORBIDDEN" }],
	])(
		"should reject empty or mixed GraphQL errors without race retries",
		async (errors, { expect }) => {
			expect.hasAssertions();

			const { port, responses } = fixture();
			responses["graphql"] = { errors };
			const failure = port.write({
				content: "intent",
				head: "head",
				path: ".changeset/renovate-pr-2.md",
			});

			await expect(failure).rejects.toBeInstanceOf(Error);
			await expect(failure).rejects.not.toBeInstanceOf(HeadChangedError);
		},
	);
});
