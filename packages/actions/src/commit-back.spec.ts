import { describe, expect, it } from "vitest";

import { commitBack } from "./commit-back.ts";
import type { GitExec, GitResult } from "./git.ts";

function ok(stdout = ""): GitResult {
	return { code: 0, stderr: "", stdout };
}

/**
 * Build a fake {@link GitExec} that records every argument vector it receives
 * and answers `git status` / `git rev-parse` / `git stash create` from the
 * supplied transcript. Every other command resolves successfully with empty
 * output, and `git push` can be made to fail a number of times.
 *
 * @param transcript - Canned stdout and the push-failure count.
 * @returns The recorded `calls` and the fake `git` runner.
 */
function fakeGit(transcript: {
	head?: string;
	pushFailures?: number;
	stashSha?: string;
	status?: string;
}): {
	calls: Array<ReadonlyArray<string>>;
	git: GitExec;
} {
	const calls: Array<ReadonlyArray<string>> = [];
	let pushes = 0;
	async function git(args: ReadonlyArray<string>): Promise<GitResult> {
		calls.push(args);
		if (args[0] === "status") {
			return ok(transcript.status ?? "");
		}

		if (args[0] === "rev-parse") {
			return ok(transcript.head ?? "");
		}

		if (args[0] === "stash" && args[1] === "create") {
			return ok(transcript.stashSha ?? "");
		}

		if (args[0] === "push") {
			pushes += 1;
			if (pushes <= (transcript.pushFailures ?? 0)) {
				return { code: 1, stderr: "rejected: tip moved", stdout: "" };
			}

			return ok();
		}

		return ok();
	}

	return { calls, git };
}

const DefaultOptions = {
	authorEmail: "bot@example.com",
	authorName: "deploy-bot",
	branch: "main",
	message: "chore(assets): regenerate asset ids [skip ci]",
	paths: ["src/shared/assets"],
} as const;

describe(commitBack, () => {
	it("should stage, reflow, commit, and push in order, returning the new commit sha", async () => {
		expect.assertions(2);

		const { calls, git } = fakeGit({
			head: "abc1234\n",
			stashSha: "stash99\n",
			status: " M src/shared/assets/places.ts\n",
		});

		const result = await commitBack({ git }, DefaultOptions);

		expect(result).toStrictEqual({ changedFiles: 1, committed: true, sha: "abc1234" });
		expect(calls).toStrictEqual([
			["status", "--porcelain", "--", "src/shared/assets"],
			["add", "--", "src/shared/assets"],
			["stash", "create"],
			["fetch", "origin", "main"],
			["checkout", "-f", "-B", "main", "FETCH_HEAD"],
			["checkout", "stash99", "--", "src/shared/assets"],
			["add", "--", "src/shared/assets"],
			[
				"-c",
				"user.name=deploy-bot",
				"-c",
				"user.email=bot@example.com",
				"commit",
				"--message",
				"chore(assets): regenerate asset ids [skip ci]",
			],
			["rev-parse", "HEAD"],
			["push", "origin", "HEAD:refs/heads/main"],
		]);
	});

	it("should count both modified and untracked files, ignoring blank lines", async () => {
		expect.assertions(1);

		const { git } = fakeGit({
			head: "abc1234\n",
			stashSha: "stash99",
			status: " M src/a.ts\n\n   \n?? src/b.ts\n",
		});

		const result = await commitBack({ git }, DefaultOptions);

		expect(result.changedFiles).toBe(2);
	});

	it("should retry the push when the branch tip moves, then succeed", async () => {
		expect.assertions(3);

		const { calls, git } = fakeGit({
			head: "abc1234\n",
			pushFailures: 1,
			stashSha: "stash99",
			status: " M src/shared/assets/places.ts\n",
		});

		const result = await commitBack({ git }, DefaultOptions);

		expect(result.committed).toBeTrue();
		expect(calls.filter((args) => args[0] === "push")).toHaveLength(2);
		expect(calls.filter((args) => args[0] === "fetch")).toHaveLength(2);
	});

	it("should fail after exhausting push attempts on a perpetually moving tip", async () => {
		expect.assertions(2);

		const { calls, git } = fakeGit({
			head: "abc1234\n",
			pushFailures: 99,
			stashSha: "stash99",
			status: " M src/shared/assets/places.ts\n",
		});

		await expect(commitBack({ git }, { ...DefaultOptions, maxAttempts: 2 })).rejects.toThrow(
			"rejected after 2 attempts",
		);
		expect(calls.filter((args) => args[0] === "push")).toHaveLength(2);
	});

	it("should reject when a required git command fails", async () => {
		expect.assertions(1);

		async function git(args: ReadonlyArray<string>): Promise<GitResult> {
			return args[0] === "status"
				? { code: 0, stderr: "", stdout: " M src/shared/assets/places.ts\n" }
				: { code: 128, stderr: "fatal: not a git repository", stdout: "" };
		}

		await expect(commitBack({ git }, DefaultOptions)).rejects.toThrow(
			"git add -- src/shared/assets failed with exit code 128",
		);
	});

	it("should not commit or push when nothing changed under the paths", async () => {
		expect.assertions(2);

		const { calls, git } = fakeGit({ status: "" });

		const result = await commitBack({ git }, DefaultOptions);

		expect(result).toStrictEqual({ changedFiles: 0, committed: false });
		expect(calls).toStrictEqual([["status", "--porcelain", "--", "src/shared/assets"]]);
	});
});
