import { describe, it, vi } from "vitest";

import { fixture, pull } from "../tests/github-fixture.spec.ts";

describe("review feedback", () => {
	it("should explicitly page foreign commit files and detect late reserved edits", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, requests, responses } = fixture();
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [{ sha: "foreign" }];
		responses["repos/owner/repo/commits/foreign?per_page=100"] = {
			author: { login: "human" },
			commit: { verification: { reason: "valid", verified: true } },
			committer: { login: "web-flow" },
			files: Array.from({ length: 100 }, () => ({ filename: "README.md" })),
		};
		responses["repos/owner/repo/commits/foreign?per_page=100&page=2"] = {
			author: { login: "human" },
			commit: { verification: { reason: "valid", verified: true } },
			committer: { login: "web-flow" },
			files: [{ filename: ".changeset/renovate-pr-2.md" }],
		};
		const state = await port.read();

		expect(state.owned).toBe(false);
		expect(requests.map(({ path }) => path)).toContain(
			"repos/owner/repo/commits/foreign?per_page=100",
		);
	});

	it("should detect a reserved edit after the thirtieth file on the first page", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [{ sha: "foreign" }];
		responses["repos/owner/repo/commits/foreign?per_page=100"] = {
			author: { login: "human" },
			commit: { verification: { reason: "valid", verified: true } },
			committer: { login: "web-flow" },
			files: [
				...Array.from({ length: 39 }, () => ({ filename: "README.md" })),
				{ filename: ".changeset/renovate-pr-2.md" },
			],
		};

		await expect(port.read()).resolves.toMatchObject({ owned: false });
	});

	it("should wait for a pending test merge to become ready", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const { port, requests, responses } = fixture();
		responses["repos/owner/repo/pulls/2"] = { ...pull, merge_commit_sha: JSON.parse("null") };
		const pending = port.read();
		const checked = pending.catch((err: unknown) => err);
		await vi.advanceTimersByTimeAsync(999);

		expect(requests.filter(({ path }) => path === "repos/owner/repo/pulls/2")).toHaveLength(1);

		responses["repos/owner/repo/pulls/2"] = pull;
		await vi.advanceTimersByTimeAsync(1);

		await expect(checked).resolves.toMatchObject({ head: "head" });

		expect(requests.filter(({ path }) => path === "repos/owner/repo/pulls/2")).toHaveLength(2);
	});

	it("should stop after three pending merge observations", async ({ expect, onTestFinished }) => {
		expect.hasAssertions();

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const { port, requests, responses } = fixture();
		responses["repos/owner/repo/pulls/2"] = { ...pull, merge_commit_sha: JSON.parse("null") };
		const checked = port.read().catch((err: unknown) => err);
		await vi.runAllTimersAsync();

		await expect(checked).resolves.toBeInstanceOf(Error);

		expect(requests.filter(({ path }) => path === "repos/owner/repo/pulls/2")).toHaveLength(3);
	});

	it("should refresh a stale merge candidate without retrying fatal identity errors", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const { port, requests, responses } = fixture();
		responses["repos/owner/repo/commits/merge"] = {
			parents: [{ sha: "old" }, { sha: "head" }],
		};
		const checked = port.read().catch((err: unknown) => err);
		await vi.advanceTimersByTimeAsync(1);
		responses["repos/owner/repo/commits/merge"] = {
			parents: [{ sha: "base" }, { sha: "head" }],
		};
		await vi.advanceTimersByTimeAsync(1000);

		await expect(checked).resolves.toMatchObject({ head: "head" });

		expect(requests.filter(({ path }) => path === "repos/owner/repo/pulls/2")).toHaveLength(2);

		responses["repos/owner/repo/pulls/2"] = { ...pull, user: { login: "human" } };

		await expect(port.read()).rejects.toThrow("same-repository Renovate PR");
		expect(vi.getTimerCount()).toBe(0);
	});
});
