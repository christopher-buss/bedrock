import { parseJSON } from "confbox";
import { describe, it, vi } from "vitest";

import { fixture, humanFixture, pull } from "../tests/github-fixture.spec.ts";

describe("gitHub HTTP contract", () => {
	it("should authenticate immutable reads with a versioned JSON request", async ({ expect }) => {
		expect.hasAssertions();

		const { port, requests } = fixture();
		await port.read();

		expect(requests.at(0)!.init).toStrictEqual({
			headers: {
				"Accept": "application/vnd.github+json",
				"Authorization": "Bearer test",
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			method: "GET",
		});
	});

	it("should send the complete conditional commit payload to the intended branch", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, requests } = fixture();
		await port.write({ content: "intent", head: "head", path: ".changeset/renovate-pr-2.md" });

		expect(requests.at(-1)!.init.method).toBe("POST");
		expect(parseJSON(String(requests.at(-1)!.body))).toStrictEqual({
			query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
			variables: {
				input: {
					branch: { branchName: "renovate/test", repositoryNameWithOwner: "owner/repo" },
					expectedHeadOid: "head",
					fileChanges: {
						additions: [{ contents: "aW50ZW50", path: ".changeset/renovate-pr-2.md" }],
					},
					message: { headline: "chore(deps): record dependency change intents" },
				},
			},
		});
	});

	it("should preserve separate GraphQL error diagnostics", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["graphql"] = {
			errors: [{ message: "head mismatch" }, { message: "retry required" }],
		};

		await expect(
			port.write({ content: "intent", head: "head", path: ".changeset/renovate-pr-2.md" }),
		).rejects.toThrow("head mismatch\nretry required");
	});

	it.for([
		{ state: "closed", user: { login: "renovate[bot]" } },
		{ state: "open", user: { login: "human" } },
	])("should reject closed and non-Renovate pull requests", async (change, { expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2"] = { ...pull, ...change };

		await expect(port.read()).rejects.toThrow("open same-repository Renovate");
	});

	it.for([
		["base", "head", "extra"],
		["base", "old"],
	])(
		"should reject unsupported merge parent arrangements",
		async (parents, { expect, onTestFinished }) => {
			expect.hasAssertions();

			const { port, responses } = fixture();
			responses["repos/owner/repo/commits/merge"] = {
				parents: parents.map((sha) => ({ sha })),
			};
			vi.useFakeTimers();
			onTestFinished(() => {
				vi.useRealTimers();
			});
			const pending = port.read().catch((err: unknown) => err);
			await vi.runAllTimersAsync();

			await expect(pending).resolves.toMatchObject({ message: "GitHub test merge is stale" });
		},
	);

	it("should accept the documented REST enumeration boundary", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2"] = { ...pull, changed_files: 3000, commits: 250 };
		const state = await port.read();

		expect(state.head).toBe("head");
	});

	it("should reject one malformed entry mixed with valid human intent coverage", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port } = humanFixture("---\ncore: patch\nother: invalid\n---\nManual decision");

		await expect(port.read()).rejects.toThrow("Invalid intent bump for other");
	});
});
