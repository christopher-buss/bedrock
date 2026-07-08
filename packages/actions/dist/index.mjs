import * as core from "@actions/core";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
//#region src/commit-back.ts
/** Push attempts before giving up when the branch tip keeps moving. */
const DEFAULT_MAX_ATTEMPTS = 3;
/**
* Commit the changes under `paths` onto the latest `branch` tip and push them,
* retrying when the tip moves under a concurrent push.
*
* @param deps - Injected `git` runner.
* @param options - Branch, paths, message, author identity, and attempt cap.
* @returns Whether a commit was pushed, how many files changed, and the new sha.
* @rejects When the push is still rejected after `maxAttempts` reflow attempts.
*/
async function commitBack(deps, options) {
	const changedFiles = parseChangedFiles((await runGit(deps, [
		"status",
		"--porcelain",
		"--",
		...options.paths
	])).stdout);
	if (changedFiles.length === 0) return {
		changedFiles: 0,
		committed: false
	};
	await runGit(deps, [
		"add",
		"--",
		...options.paths
	]);
	const stashSha = (await runGit(deps, ["stash", "create"])).stdout.trim();
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const outcome = await reflowOntoTip(deps, {
			...options,
			stashSha
		});
		if (outcome.kind === "committed") return {
			changedFiles: changedFiles.length,
			committed: true,
			sha: outcome.sha
		};
		if (outcome.kind === "converged") return {
			changedFiles: changedFiles.length,
			committed: false
		};
	}
	throw new Error(`commit-back: push to ${options.branch} rejected after ${String(maxAttempts)} attempts`);
}
/**
* Run a git command that must succeed, rejecting if it exits non-zero so a
* failure surfaces instead of silently corrupting the reflow. These commands
* carry no secret (the authenticated remote URL is configured by the action
* shell, not here), so the error can echo the full argument vector.
*
* @param deps - Injected `git` runner.
* @param args - The git argument vector.
* @returns The successful {@link GitResult}.
* @rejects When the command exits with a non-zero code.
*/
async function runGit(deps, args) {
	const result = await deps.git(args);
	if (result.code !== 0) throw new Error(`commit-back: git ${args.join(" ")} failed with exit code ${result.code}`);
	return result;
}
/**
* Reset onto the latest branch tip, restore the generated paths from the stash
* commit, commit, and push once.
*
* @param deps - Injected `git` runner.
* @param plan - Commit options plus the `stashSha` capturing the generated files.
* @returns The pushed sha (`committed`), a `converged` no-op when the tip
* already has the files, or `rejected` when the push lost a race.
*/
async function reflowOntoTip(deps, plan) {
	const { stashSha, ...options } = plan;
	await runGit(deps, [
		"fetch",
		"origin",
		options.branch
	]);
	await runGit(deps, [
		"checkout",
		"-f",
		"-B",
		options.branch,
		"FETCH_HEAD"
	]);
	await runGit(deps, [
		"checkout",
		stashSha,
		"--",
		...options.paths
	]);
	await runGit(deps, [
		"add",
		"--",
		...options.paths
	]);
	if ((await deps.git([
		"diff",
		"--cached",
		"--quiet",
		"--",
		...options.paths
	])).code === 0) return { kind: "converged" };
	await runGit(deps, [
		"-c",
		`user.name=${options.authorName}`,
		"-c",
		`user.email=${options.authorEmail}`,
		"commit",
		"--message",
		options.message
	]);
	const head = await runGit(deps, ["rev-parse", "HEAD"]);
	return (await deps.git([
		"push",
		"origin",
		`HEAD:refs/heads/${options.branch}`
	])).code === 0 ? {
		kind: "committed",
		sha: head.stdout.trim()
	} : { kind: "rejected" };
}
function parseChangedFiles(stdout) {
	return stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}
//#endregion
//#region src/commit-back-action.ts
const DEFAULT_BRANCH = "main";
const DEFAULT_MESSAGE = "chore(assets): regenerate asset ids [skip ci]";
const DEFAULT_AUTHOR_NAME = "github-actions[bot]";
const DEFAULT_AUTHOR_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const DEFAULT_SERVER_URL = "https://github.com";
const WHITESPACE_PATTERN = /\s+/u;
/**
* Resolve the action's inputs into a commit-back plan plus the token-authenticated
* `origin` URL the push authenticates through.
*
* @param deps - Input and env readers.
* @returns The commit-back options and the authenticated remote URL.
* @rejects When a required input (`token`, `paths`) or env (`GITHUB_REPOSITORY`)
* is missing, or `max-attempts` is not a positive integer.
*/
function resolveActionConfig(deps) {
	const token = requireInput(deps.readInput, "token");
	const paths = requireInput(deps.readInput, "paths").split(WHITESPACE_PATTERN);
	const serverUrl = deps.getEnv("GITHUB_SERVER_URL") ?? DEFAULT_SERVER_URL;
	const repo = requireEnvironment(deps.getEnv, "GITHUB_REPOSITORY");
	return {
		options: {
			authorEmail: optionalInput(deps.readInput("author-email"), DEFAULT_AUTHOR_EMAIL),
			authorName: optionalInput(deps.readInput("author-name"), DEFAULT_AUTHOR_NAME),
			branch: optionalInput(deps.readInput("branch"), DEFAULT_BRANCH),
			message: optionalInput(deps.readInput("message"), DEFAULT_MESSAGE),
			paths,
			...parseMaxAttempts(deps.readInput("max-attempts"))
		},
		remoteUrl: authenticatedUrl({
			repository: repo,
			serverUrl,
			token
		})
	};
}
/**
* Run the commit-back GitHub Action: authenticate `origin` with the supplied
* token, reflow the generated paths onto the branch tip, and record the
* `committed`, `changed-files`, and `sha` outputs.
*
* @param deps - Injected git runner, input/env readers, and output sink.
* @rejects When configuration is invalid or the push exhausts its attempts.
*/
async function runCommitBackAction(deps) {
	const { options, remoteUrl } = resolveActionConfig(deps);
	const urlResult = await deps.git([
		"remote",
		"set-url",
		"origin",
		remoteUrl
	]);
	if (urlResult.code !== 0) throw new Error(`commit-back: failed to set the origin URL (exit code ${urlResult.code})`);
	const result = await commitBack({ git: deps.git }, options);
	deps.setOutput("committed", String(result.committed));
	deps.setOutput("changed-files", String(result.changedFiles));
	deps.setOutput("sha", result.sha ?? "");
}
/**
* The action's composition root: mask the token, wire the toolkit and process
* env into {@link runCommitBackAction}, and convert any failure into
* `setFailed`. Kept here (rather than the bundler entrypoint) so it is fully
* tested; `main.ts` only supplies the real `@actions/core`, `process.env`, and
* git adapter.
*
* @param deps - The `@actions/core` slice, process environment, and git runner.
*/
async function executeCommitBackAction(deps) {
	const { environment, git, io } = deps;
	io.setSecret(io.getInput("token"));
	try {
		await runCommitBackAction({
			getEnv: (name) => environment[name],
			git,
			readInput: io.getInput,
			setOutput: io.setOutput
		});
	} catch (err) {
		io.setFailed(err instanceof Error ? err.message : String(err));
	}
}
function authenticatedUrl(parts) {
	const url = new URL(parts.serverUrl);
	url.username = "x-access-token";
	url.password = parts.token;
	url.pathname = `/${parts.repository}.git`;
	return url.href;
}
function optionalInput(raw, fallback) {
	const value = raw.trim();
	return value === "" ? fallback : value;
}
function parseMaxAttempts(raw) {
	if (raw.trim() === "") return {};
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) throw new Error(`commit-back: 'max-attempts' must be a positive integer, got '${raw}'`);
	return { maxAttempts: value };
}
function requireEnvironment(getEnvironment, name) {
	const value = getEnvironment(name);
	if (value === void 0 || value.trim() === "") throw new Error(`commit-back: missing required environment variable '${name}'`);
	return value;
}
function requireInput(readInput, name) {
	const value = readInput(name).trim();
	if (value === "") throw new Error(`commit-back: missing required input '${name}'`);
	return value;
}
//#endregion
//#region src/git-exec.ts
/** Generous output ceiling so large `git diff` output is never truncated. */
const MAX_BUFFER = 64 * 1024 * 1024;
const execFileAsync = promisify(execFile);
/**
* Translate a rejected `execFile` error into a {@link GitResult}: a numeric exit
* code passes through, anything else (a launch errno such as `ENOENT`) collapses
* to `1`, and absent output normalizes to an empty string. Extracted so every
* branch is unit-testable without provoking a real launch failure.
*
* `failure.code` is the numeric exit status, or a string errno (e.g. `ENOENT`)
* when the binary could not be spawned; `stdout`/`stderr` carry whatever the
* process emitted before failing.
*
* @param failure - The error thrown by `promisify(execFile)`.
* @returns The equivalent non-success {@link GitResult}.
*/
function classifyExecFailure(failure) {
	return {
		code: typeof failure.code === "number" ? failure.code : 1,
		stderr: failure.stderr ?? "",
		stdout: failure.stdout ?? ""
	};
}
/**
* Build a {@link GitExec} backed by `node:child_process.execFile`. The promise
* resolves (never rejects) with the captured exit code and output, so callers
* like `commitBack` can treat a non-zero push as a retry signal rather than a
* thrown error.
*
* @param deps - Optional git binary override and working directory.
* @returns A `GitExec` bound to the configured git binary.
*/
function createGitExec(deps = {}) {
	const binary = deps.binary ?? "git";
	return async (args) => {
		try {
			const { stderr, stdout } = await execFileAsync(binary, [...args], {
				cwd: deps.cwd,
				maxBuffer: MAX_BUFFER
			});
			return {
				code: 0,
				stderr,
				stdout
			};
		} catch (err) {
			return classifyExecFailure(err);
		}
	};
}
//#endregion
//#region src/main.ts
executeCommitBackAction({
	environment: process.env,
	git: createGitExec(),
	io: core
});
//#endregion
export {};
