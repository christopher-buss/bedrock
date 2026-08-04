import { describe, expect, it } from "vitest";

import type { GitResponses } from "#tests/helpers/fake-git";
import { fakeGit, gitFail, gitOk } from "#tests/helpers/fake-git";
import {
	type ActionIo,
	type CommitBackActionDeps as CommitBackActionDependencies,
	executeCommitBackAction,
	resolveActionConfig,
	runCommitBackAction,
} from "./commit-back-action.ts";
import type { GitResult } from "./git.ts";

interface Harness {
	deps: CommitBackActionDependencies;
	gitCalls: Array<ReadonlyArray<string>>;
	outputs: Record<string, string>;
}

function fakeIo(): {
	failures: Array<string>;
	io: ActionIo;
	secrets: Array<string>;
} {
	const failures: Array<string> = [];
	const secrets: Array<string> = [];
	const inputs: Record<string, string> = { paths: "src/shared/assets", token: "ghs_secret" };
	return {
		failures,
		io: {
			getInput: (name) => inputs[name] ?? "",
			setFailed: (message) => {
				failures.push(message);
			},
			setOutput: () => {},
			setSecret: (value) => {
				secrets.push(value);
			},
		},
		secrets,
	};
}

function harness(overrides?: {
	env?: Record<string, string>;
	git?: GitResponses;
	inputs?: Record<string, string>;
}): Harness {
	const inputs: Record<string, string> = {
		paths: "src/shared/assets",
		token: "ghs_secret",
		...overrides?.inputs,
	};
	const environment: Record<string, string> = {
		GITHUB_REPOSITORY: "acme/game",
		...overrides?.env,
	};
	const outputs: Record<string, string> = {};
	const { calls, git } = fakeGit(overrides?.git);
	return {
		deps: {
			getEnv: (name) => environment[name],
			git,
			readInput: (name) => inputs[name] ?? "",
			setOutput: (name, value) => {
				outputs[name] = value;
			},
		},
		gitCalls: calls,
		outputs,
	};
}

describe(runCommitBackAction, () => {
	it("should authenticate origin with the token and record outputs on a commit", async () => {
		expect.assertions(2);

		const { deps, gitCalls, outputs } = harness({
			git: { status: gitOk(" M src/shared/assets/places.ts\n") },
		});

		await runCommitBackAction(deps);

		expect(gitCalls).toContainEqual([
			"remote",
			"set-url",
			"origin",
			"https://x-access-token:ghs_secret@github.com/acme/game.git",
		]);
		expect(outputs).toStrictEqual({
			"changed-files": "1",
			"committed": "true",
			"sha": "sha123",
		});
	});

	it("should clear the persisted checkout credentials right after authenticating origin", async () => {
		expect.assertions(2);

		const { deps, gitCalls } = harness({
			git: { status: gitOk(" M src/shared/assets/places.ts\n") },
		});

		await runCommitBackAction(deps);

		expect(gitCalls[0]![0]).toBe("remote");
		expect(gitCalls[1]).toStrictEqual([
			"config",
			"--local",
			"--unset-all",
			"http.https://github.com/.extraheader",
		]);
	});

	it("should derive the extraheader key from GITHUB_SERVER_URL, normalizing a trailing slash", async () => {
		expect.assertions(1);

		const { deps, gitCalls } = harness({ env: { GITHUB_SERVER_URL: "https://ghe.corp/" } });

		await runCommitBackAction(deps);

		expect(gitCalls).toContainEqual([
			"config",
			"--local",
			"--unset-all",
			"http.https://ghe.corp/.extraheader",
		]);
	});

	it("should tolerate exit code 5 when no extraheader was persisted", async () => {
		expect.assertions(1);

		const { deps, outputs } = harness({ git: { configUnsetExtraheader: gitFail(5) } });

		await runCommitBackAction(deps);

		expect(outputs).toStrictEqual({
			"changed-files": "0",
			"committed": "false",
			"sha": "",
		});
	});

	it("should list the local config by key name to find persisted includes", async () => {
		expect.assertions(1);

		const { deps, gitCalls } = harness();

		await runCommitBackAction(deps);

		expect(gitCalls).toContainEqual(["config", "--local", "--list", "--name-only"]);
	});

	it("should unset every includeif key persisted in the local config", async () => {
		expect.assertions(2);

		const listing =
			"core.bare\nincludeif.gitdir:/w/.git.path\nincludeif.gitdir:/w/.git/worktrees/*.path\n";
		const { deps, gitCalls } = harness({ git: { configList: gitOk(listing) } });

		await runCommitBackAction(deps);

		expect(gitCalls).toContainEqual([
			"config",
			"--local",
			"--unset-all",
			"includeif.gitdir:/w/.git.path",
		]);
		expect(gitCalls).toContainEqual([
			"config",
			"--local",
			"--unset-all",
			"includeif.gitdir:/w/.git/worktrees/*.path",
		]);
	});

	it("should strip the carriage return from a crlf-terminated listing line", async () => {
		expect.assertions(1);

		const listing = "includeif.gitdir:/w/.git.path\r\n";
		const { deps, gitCalls } = harness({ git: { configList: gitOk(listing) } });

		await runCommitBackAction(deps);

		expect(gitCalls).toContainEqual([
			"config",
			"--local",
			"--unset-all",
			"includeif.gitdir:/w/.git.path",
		]);
	});

	it("should unset a repeated includeif key only once", async () => {
		expect.assertions(1);

		const listing = "includeif.gitdir:/w/.git.path\nincludeif.gitdir:/w/.git.path\n";
		const { deps, gitCalls } = harness({ git: { configList: gitOk(listing) } });

		await runCommitBackAction(deps);

		const clearedKeys = gitCalls.filter((args) => args[3] === "includeif.gitdir:/w/.git.path");

		expect(clearedKeys).toHaveLength(1);
	});

	it("should not unset config keys outside the includeif section", async () => {
		expect.assertions(1);

		const listing = "core.bare\nremote.origin.url\nbranch.main.remote\n";
		const { deps, gitCalls } = harness({ git: { configList: gitOk(listing) } });

		await runCommitBackAction(deps);

		const clearedKeys = gitCalls.filter((args) => args.includes("--unset-all"));

		expect(clearedKeys).toStrictEqual([
			["config", "--local", "--unset-all", "http.https://github.com/.extraheader"],
		]);
	});

	it("should tolerate exit code 5 when an includeif key vanished before the unset", async () => {
		expect.assertions(1);

		const listing = "includeif.gitdir:/w/.git.path\n";
		const { deps, outputs } = harness({
			git: { configList: gitOk(listing), configUnsetInclude: gitFail(5) },
		});

		await runCommitBackAction(deps);

		expect(outputs).toStrictEqual({
			"changed-files": "0",
			"committed": "false",
			"sha": "",
		});
	});

	it("should reject when listing the local config fails", async () => {
		expect.assertions(1);

		const { deps } = harness({
			git: { configList: gitFail(128, { stderr: "fatal: bad config" }) },
		});

		await expect(runCommitBackAction(deps)).rejects.toThrow(
			"commit-back: failed to list the local git config (exit code 128): fatal: bad config",
		);
	});

	it("should reject when clearing an includeif key fails for another reason", async () => {
		expect.assertions(1);

		const listing = "includeif.gitdir:/w/.git.path\n";
		const { deps } = harness({
			git: {
				configList: gitOk(listing),
				configUnsetInclude: gitFail(3, { stderr: "error: invalid config file" }),
			},
		});

		await expect(runCommitBackAction(deps)).rejects.toThrow(
			"commit-back: failed to clear the persisted include 'includeif.gitdir:/w/.git.path' (exit code 3): error: invalid config file",
		);
	});

	it("should reject when clearing the extraheader fails for another reason", async () => {
		expect.assertions(1);

		const { deps } = harness({
			git: { configUnsetExtraheader: gitFail(3, { stderr: "error: invalid config file" }) },
		});

		await expect(runCommitBackAction(deps)).rejects.toThrow(
			"commit-back: failed to clear the persisted http.extraheader (exit code 3): error: invalid config file",
		);
	});

	it("should record a no-op with an empty sha when nothing changed", async () => {
		expect.assertions(1);

		const { deps, outputs } = harness();

		await runCommitBackAction(deps);

		expect(outputs).toStrictEqual({
			"changed-files": "0",
			"committed": "false",
			"sha": "",
		});
	});

	it("should reject without leaking the token when the remote URL cannot be set", async () => {
		expect.assertions(3);

		const { deps } = harness({
			git: {
				remoteSetUrl: gitFail(1, {
					stderr: "fatal: could not set 'https://x-access-token:ghs_secret@github.com/acme/game.git'",
				}),
			},
		});

		const rejection = runCommitBackAction(deps);

		await expect(rejection).rejects.toThrow("failed to set the origin URL");
		await expect(rejection).rejects.toThrow("https://***@github.com/acme/game.git");
		await expect(rejection).rejects.not.toThrow("ghs_secret");
	});
});

describe(executeCommitBackAction, () => {
	const environment = { GITHUB_REPOSITORY: "acme/game" };

	it("should mask the token and complete without failing on success", async () => {
		expect.assertions(2);

		const { failures, io, secrets } = fakeIo();
		async function git(): Promise<GitResult> {
			return { code: 0, stderr: "", stdout: "" };
		}

		await executeCommitBackAction({ environment, git, io });

		expect(secrets).toStrictEqual(["ghs_secret"]);
		expect(failures).toStrictEqual([]);
	});

	it("should report an Error message via setFailed", async () => {
		expect.assertions(1);

		const { failures, io } = fakeIo();
		const { git } = fakeGit({ remoteSetUrl: gitFail(1) });

		await executeCommitBackAction({ environment, git, io });

		expect(failures[0]).toContain("failed to set the origin URL");
	});

	it("should report a token-read failure via setFailed instead of rejecting", async () => {
		expect.assertions(1);

		const { failures, io } = fakeIo();
		const throwingIo = {
			...io,
			getInput: (): string => {
				throw new Error("input store corrupted");
			},
		};
		async function git(): Promise<GitResult> {
			return { code: 0, stderr: "", stdout: "" };
		}

		await executeCommitBackAction({ environment, git, io: throwingIo });

		expect(failures).toStrictEqual(["input store corrupted"]);
	});

	it("should stringify a non-Error failure for setFailed", async () => {
		expect.assertions(1);

		const { failures, io } = fakeIo();
		async function git(): Promise<GitResult> {
			// eslint-disable-next-line ts/only-throw-error -- exercises the non-Error catch branch
			throw "kaboom";
		}

		await executeCommitBackAction({ environment, git, io });

		expect(failures).toStrictEqual(["kaboom"]);
	});
});

describe(resolveActionConfig, () => {
	it("should apply defaults for the optional inputs", () => {
		expect.assertions(1);

		const { deps } = harness();

		const { options } = resolveActionConfig(deps);

		expect(options).toStrictEqual({
			authorEmail: "41898282+github-actions[bot]@users.noreply.github.com",
			authorName: "github-actions[bot]",
			branch: "main",
			message: "chore(assets): regenerate asset ids [skip ci]",
			paths: ["src/shared/assets"],
		});
	});

	it("should fall back to defaults when the optional inputs are whitespace-only", () => {
		expect.assertions(1);

		const { deps } = harness({
			inputs: {
				"author-email": "  ",
				"author-name": "\t",
				"branch": " ".repeat(3),
				"message": " ",
			},
		});

		const { options } = resolveActionConfig(deps);

		expect(options).toStrictEqual({
			authorEmail: "41898282+github-actions[bot]@users.noreply.github.com",
			authorName: "github-actions[bot]",
			branch: "main",
			message: "chore(assets): regenerate asset ids [skip ci]",
			paths: ["src/shared/assets"],
		});
	});

	it("should honor explicit branch, message, authors, and max-attempts", () => {
		expect.assertions(1);

		const { deps } = harness({
			inputs: {
				"author-email": "bot@acme.dev",
				"author-name": "acme-bot",
				"branch": "release",
				"max-attempts": "5",
				"message": "regenerate [skip ci]",
				"paths": "a/one b/two",
				"token": "t",
			},
		});

		const { options } = resolveActionConfig(deps);

		expect(options).toStrictEqual({
			authorEmail: "bot@acme.dev",
			authorName: "acme-bot",
			branch: "release",
			maxAttempts: 5,
			message: "regenerate [skip ci]",
			paths: ["a/one", "b/two"],
		});
	});

	it("should split paths on runs of whitespace", () => {
		expect.assertions(1);

		const { deps } = harness({ inputs: { paths: "a/one \t b/two   c/three" } });

		expect(resolveActionConfig(deps).options.paths).toStrictEqual([
			"a/one",
			"b/two",
			"c/three",
		]);
	});

	it("should accept max-attempts of exactly 1", () => {
		expect.assertions(1);

		const { deps } = harness({ inputs: { "max-attempts": "1" } });

		expect(resolveActionConfig(deps).options.maxAttempts).toBe(1);
	});

	it("should reject a max-attempts of 0", () => {
		expect.assertions(1);

		const { deps } = harness({ inputs: { "max-attempts": "0" } });

		expect(() => resolveActionConfig(deps)).toThrow(
			"'max-attempts' must be a positive integer",
		);
	});

	it("should treat a whitespace-only max-attempts as unset", () => {
		expect.assertions(1);

		const { deps } = harness({ inputs: { "max-attempts": "  " } });

		expect(resolveActionConfig(deps).options.maxAttempts).toBeUndefined();
	});

	it("should reject a whitespace-only token", () => {
		expect.assertions(1);

		const { deps } = harness({ inputs: { token: " ".repeat(3) } });

		expect(() => resolveActionConfig(deps)).toThrow("missing required input 'token'");
	});

	it("should reject a whitespace-only GITHUB_REPOSITORY", () => {
		expect.assertions(1);

		const { deps } = harness({ env: { GITHUB_REPOSITORY: " ".repeat(3) } });

		expect(() => resolveActionConfig(deps)).toThrow(
			"missing required environment variable 'GITHUB_REPOSITORY'",
		);
	});

	it("should build the remote URL from an enterprise GITHUB_SERVER_URL", () => {
		expect.assertions(1);

		const { deps } = harness({ env: { GITHUB_SERVER_URL: "https://ghe.corp" } });

		const { remoteUrl } = resolveActionConfig(deps);

		expect(remoteUrl).toBe("https://x-access-token:ghs_secret@ghe.corp/acme/game.git");
	});

	it("should reject a missing token", () => {
		expect.assertions(1);

		const { deps } = harness({ inputs: { token: "" } });

		expect(() => resolveActionConfig(deps)).toThrow("missing required input 'token'");
	});

	it("should reject missing paths", () => {
		expect.assertions(1);

		const { deps } = harness({ inputs: { paths: "" } });

		expect(() => resolveActionConfig(deps)).toThrow("missing required input 'paths'");
	});

	it("should reject a missing GITHUB_REPOSITORY", () => {
		expect.assertions(1);

		const { deps } = harness({ env: { GITHUB_REPOSITORY: "" } });

		expect(() => resolveActionConfig(deps)).toThrow(
			"missing required environment variable 'GITHUB_REPOSITORY'",
		);
	});

	it("should reject a non-integer max-attempts", () => {
		expect.assertions(1);

		const { deps } = harness({ inputs: { "max-attempts": "soon" } });

		expect(() => resolveActionConfig(deps)).toThrow(
			"'max-attempts' must be a positive integer",
		);
	});
});
