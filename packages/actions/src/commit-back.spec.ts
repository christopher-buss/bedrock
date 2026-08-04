import { describe, expect, it } from "vitest";

import { fakeGit, gitFail, gitOk } from "#tests/helpers/fake-git";
import { commitBack } from "./commit-back.ts";

/** The stderr a moved branch tip produces, which the reflow retries. */
const REJECTED = gitFail(1, { stderr: " ! [rejected] main -> main (fetch first)" });

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
			revParse: gitOk("abc1234\n"),
			stashCreate: gitOk("stash99\n"),
			status: gitOk(" M src/shared/assets/places.ts\n"),
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
			["diff", "--cached", "--quiet", "--", "src/shared/assets"],
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
			revParse: gitOk("abc1234\n"),
			stashCreate: gitOk("stash99"),
			status: gitOk(" M src/a.ts\n\n   \n?? src/b.ts\n"),
		});

		const result = await commitBack({ git }, DefaultOptions);

		expect(result.changedFiles).toBe(2);
	});

	it("should retry the push when the branch tip moves, then succeed", async () => {
		expect.assertions(3);

		const { calls, git } = fakeGit({
			push: [REJECTED, gitOk()],
			revParse: gitOk("abc1234\n"),
			stashCreate: gitOk("stash99"),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		const result = await commitBack({ git }, DefaultOptions);

		expect(result.committed).toBeTrue();
		expect(calls.filter((args) => args[0] === "push")).toHaveLength(2);
		expect(calls.filter((args) => args[0] === "fetch")).toHaveLength(2);
	});

	it("should fail after exhausting push attempts on a perpetually moving tip", async () => {
		expect.assertions(2);

		const { calls, git } = fakeGit({
			push: [REJECTED],
			revParse: gitOk("abc1234\n"),
			stashCreate: gitOk("stash99"),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		await expect(commitBack({ git }, { ...DefaultOptions, maxAttempts: 2 })).rejects.toThrow(
			"rejected after 2 attempts",
		);
		expect(calls.filter((args) => args[0] === "push")).toHaveLength(2);
	});

	it("should fail fast with the push stderr when the push fails for a non-rejection reason", async () => {
		expect.assertions(2);

		const { calls, git } = fakeGit({
			push: [
				gitFail(1, {
					stderr: "remote: Permission to acme/game.git denied to deploy-bot.\nfatal: unable to access the repository: The requested URL returned error: 403\n",
				}),
			],
			revParse: gitOk("abc1234\n"),
			stashCreate: gitOk("stash99"),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		await expect(commitBack({ git }, DefaultOptions)).rejects.toThrow(
			/^commit-back: push to main failed: remote: Permission to acme\/game\.git denied to deploy-bot\.\nfatal: unable to access the repository: The requested URL returned error: 403$/u,
		);
		expect(calls.filter((args) => args[0] === "push")).toHaveLength(1);
	});

	it("should redact url credentials from the push stderr in the failure message", async () => {
		expect.assertions(2);

		const { git } = fakeGit({
			push: [
				gitFail(1, {
					stderr: "fatal: unable to access 'https://x-access-token:ghs_secret@github.com/acme/game.git/': The requested URL returned error: 403",
				}),
			],
			revParse: gitOk("abc1234\n"),
			stashCreate: gitOk("stash99"),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		const rejection = commitBack({ git }, DefaultOptions);

		await expect(rejection).rejects.toThrow(
			"fatal: unable to access 'https://***@github.com/acme/game.git/': The requested URL returned error: 403",
		);
		await expect(rejection).rejects.not.toThrow("ghs_secret");
	});

	it.for([
		" ! [rejected]        main -> main",
		"hint: Updates were rejected because the remote contains work. Try fetch first.",
		"error: failed to push some refs (non-fast-forward)",
	])("should retry a push whose stderr is %j", async (stderr) => {
		expect.assertions(2);

		const { calls, git } = fakeGit({
			push: [gitFail(1, { stderr }), gitOk()],
			revParse: gitOk("abc1234\n"),
			stashCreate: gitOk("stash99"),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		const result = await commitBack({ git }, DefaultOptions);

		expect(result.committed).toBeTrue();
		expect(calls.filter((args) => args[0] === "push")).toHaveLength(2);
	});

	it("should converge as a no-op when the tip already carries the generated files", async () => {
		expect.assertions(3);

		const { calls, git } = fakeGit({
			// `diff --cached --quiet` exiting 0 means the tip already matches.
			diff: gitOk(),
			revParse: gitOk("abc1234\n"),
			stashCreate: gitOk("stash99"),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		const result = await commitBack({ git }, DefaultOptions);

		expect(result).toStrictEqual({ changedFiles: 1, committed: false });
		expect(calls.filter((args) => args[0] === "push")).toHaveLength(0);
		expect(calls.filter((args) => args.includes("commit"))).toHaveLength(0);
	});

	it("should reject with the failing command's stderr when a required git command fails", async () => {
		expect.assertions(1);

		const { git } = fakeGit({
			add: gitFail(128, { stderr: "fatal: not a git repository" }),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		await expect(commitBack({ git }, DefaultOptions)).rejects.toThrow(
			"git add -- src/shared/assets failed with exit code 128: fatal: not a git repository",
		);
	});

	it("should redact url credentials echoed in a failing command's stderr", async () => {
		expect.assertions(2);

		const { git } = fakeGit({
			add: gitFail(128, {
				stderr: "fatal: unable to access 'https://x-access-token:ghs_secret@github.com/acme/game.git/': 403",
			}),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		const rejection = commitBack({ git }, DefaultOptions);

		await expect(rejection).rejects.toThrow("https://***@github.com/acme/game.git");
		await expect(rejection).rejects.not.toThrow("ghs_secret");
	});

	it("should fall back to the failing command's trimmed stdout when its stderr is empty", async () => {
		expect.assertions(1);

		const { git } = fakeGit({
			add: gitFail(128, { stdout: "error printed to stdout\n" }),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		await expect(commitBack({ git }, DefaultOptions)).rejects.toThrow(
			/failed with exit code 128: error printed to stdout$/u,
		);
	});

	it("should keep the bare exit-code message when the failing command produced no output", async () => {
		expect.assertions(1);

		const { git } = fakeGit({
			add: gitFail(128, { stderr: " " }),
			status: gitOk(" M src/shared/assets/places.ts\n"),
		});

		await expect(commitBack({ git }, DefaultOptions)).rejects.toThrow(
			/failed with exit code 128$/u,
		);
	});

	it("should not commit or push when nothing changed under the paths", async () => {
		expect.assertions(2);

		const { calls, git } = fakeGit({ status: gitOk("") });

		const result = await commitBack({ git }, DefaultOptions);

		expect(result).toStrictEqual({ changedFiles: 0, committed: false });
		expect(calls).toStrictEqual([["status", "--porcelain", "--", "src/shared/assets"]]);
	});
});
