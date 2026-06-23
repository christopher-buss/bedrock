import { describe, expect, it } from "vitest";

import {
	type CommitBackActionDeps,
	resolveActionConfig,
	runCommitBackAction,
} from "./commit-back-action.ts";
import type { GitExec, GitResult } from "./git.ts";

interface Harness {
	deps: CommitBackActionDeps;
	gitCalls: Array<ReadonlyArray<string>>;
	outputs: Record<string, string>;
}

function ok(stdout = ""): GitResult {
	return { code: 0, stderr: "", stdout };
}

function harness(overrides?: {
	diff?: string;
	env?: Record<string, string>;
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
	const gitCalls: Array<ReadonlyArray<string>> = [];
	async function git(args: ReadonlyArray<string>): Promise<GitResult> {
		gitCalls.push(args);
		if (args[0] === "diff") {
			return ok(overrides?.diff ?? "");
		}

		if (args[0] === "rev-parse") {
			return ok("sha123\n");
		}

		if (args[0] === "stash" && args[1] === "create") {
			return ok("stash1");
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

		const { deps, gitCalls, outputs } = harness({ diff: "src/shared/assets/places.ts\n" });

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

		const { deps, outputs } = harness({ diff: "" });

		await runCommitBackAction(deps);

		expect(outputs).toStrictEqual({
			"changed-files": "0",
			"committed": "false",
			"sha": "",
		});
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
