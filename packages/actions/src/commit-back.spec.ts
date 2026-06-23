import { describe, expect, it } from "vitest";

import { commitBack } from "./commit-back.ts";
import type { GitExec, GitResult } from "./git.ts";

function ok(stdout = ""): GitResult {
	return { code: 0, stderr: "", stdout };
}

/**
 * Build a fake {@link GitExec} that records every argument vector it receives
 * and answers `git diff` / `git rev-parse` from the supplied transcript. Every
 * other command resolves successfully with empty output.
 *
 * @param transcript - Canned stdout for the `diff` and `rev-parse` commands.
 * @returns The recorded `calls` and the fake `git` runner.
 */
function fakeGit(transcript: { diff?: string; head?: string }): {
	calls: Array<ReadonlyArray<string>>;
	git: GitExec;
} {
	const calls: Array<ReadonlyArray<string>> = [];
	async function git(args: ReadonlyArray<string>): Promise<GitResult> {
		calls.push(args);
		if (args[0] === "diff") {
			return ok(transcript.diff ?? "");
		}

		if (args[0] === "rev-parse") {
			return ok(transcript.head ?? "");
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
	it("should commit and push the changed files, returning the new commit sha", async () => {
		expect.assertions(3);

		const { calls, git } = fakeGit({
			diff: "src/shared/assets/places.ts\n",
			head: "abc1234\n",
		});

		const result = await commitBack({ git }, DefaultOptions);

		expect(result).toStrictEqual({ changedFiles: 1, committed: true, sha: "abc1234" });
		expect(calls.some((args) => args.includes("commit"))).toBeTrue();
		expect(calls.some((args) => args.includes("push"))).toBeTrue();
	});

	it("should not commit or push when nothing changed under the paths", async () => {
		expect.assertions(3);

		const { calls, git } = fakeGit({ diff: "" });

		const result = await commitBack({ git }, DefaultOptions);

		expect(result).toStrictEqual({ changedFiles: 0, committed: false });
		expect(calls.some((args) => args.includes("commit"))).toBeFalse();
		expect(calls.some((args) => args.includes("push"))).toBeFalse();
	});
});
