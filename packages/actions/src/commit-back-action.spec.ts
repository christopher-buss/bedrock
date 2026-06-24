import { describe, expect, it } from "vitest";

import {
	type ActionIo,
	type CommitBackActionDeps,
	executeCommitBackAction,
	resolveActionConfig,
	runCommitBackAction,
} from "./commit-back-action.ts";
import type { GitExec, GitResult } from "./git.ts";

interface Harness {
	deps: CommitBackActionDeps;
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

function ok(stdout = ""): GitResult {
	return { code: 0, stderr: "", stdout };
}

function harness(overrides?: {
	env?: Record<string, string>;
	inputs?: Record<string, string>;
	status?: string;
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
	const gitCalls: Array<ReadonlyArray<string>> = [];
	async function git(args: ReadonlyArray<string>): Promise<GitResult> {
		gitCalls.push(args);
		if (args[0] === "status") {
			return ok(overrides?.status ?? "");
		}

		if (args[0] === "rev-parse") {
			return ok("sha123\n");
		}

		if (args[0] === "stash" && args[1] === "create") {
			return ok("stash1");
		}

		if (args[0] === "diff") {
			// Non-zero "differences exist" so the reflow proceeds to commit.
			return { code: 1, stderr: "", stdout: "" };
		}

		return ok();
	}

	const git2: GitExec = git;
	return {
		deps: {
			getEnv: (name) => environment[name],
			git: git2,
			readInput: (name) => inputs[name] ?? "",
			setOutput: (name, value) => {
				outputs[name] = value;
			},
		},
		gitCalls,
		outputs,
	};
}

describe(runCommitBackAction, () => {
	it("should authenticate origin with the token and record outputs on a commit", async () => {
		expect.assertions(2);

		const { deps, gitCalls, outputs } = harness({ status: " M src/shared/assets/places.ts\n" });

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
		expect.assertions(2);

		const { deps } = harness();
		const failing: CommitBackActionDeps = {
			...deps,
			git: async (args) => {
				return args[0] === "remote"
					? { code: 1, stderr: "error", stdout: "" }
					: { code: 0, stderr: "", stdout: "" };
			},
		};

		const rejection = runCommitBackAction(failing);

		await expect(rejection).rejects.toThrow("failed to set the origin URL");
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
		async function git(args: ReadonlyArray<string>): Promise<GitResult> {
			return args[0] === "remote"
				? { code: 1, stderr: "", stdout: "" }
				: { code: 0, stderr: "", stdout: "" };
		}

		await executeCommitBackAction({ environment, git, io });

		expect(failures[0]).toContain("failed to set the origin URL");
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
				"branch": "   ",
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

		const { deps } = harness({ inputs: { token: "   " } });

		expect(() => resolveActionConfig(deps)).toThrow("missing required input 'token'");
	});

	it("should reject a whitespace-only GITHUB_REPOSITORY", () => {
		expect.assertions(1);

		const { deps } = harness({ env: { GITHUB_REPOSITORY: "   " } });

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
