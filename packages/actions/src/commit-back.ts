import type { GitExec } from "./git.ts";

/** Push attempts before giving up when the branch tip keeps moving. */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Dependencies for {@link commitBack}. */
export interface CommitBackDeps {
	/** Runs `git`; the real adapter shells the binary, tests inject a fake. */
	readonly git: GitExec;
}

/** Inputs controlling a single commit-back run. */
export interface CommitBackOptions {
	/** Commit author email. */
	readonly authorEmail: string;
	/** Commit author name. */
	readonly authorName: string;
	/** Branch the regenerated files are committed onto. */
	readonly branch: string;
	/** Maximum push attempts before giving up on a moving branch tip. */
	readonly maxAttempts?: number;
	/** Commit message; carries a CI-skip marker by convention. */
	readonly message: string;
	/** Paths whose changes are reflowed (typically the codegen output dir). */
	readonly paths: ReadonlyArray<string>;
}

/** Outcome of a commit-back run. */
export interface CommitBackResult {
	/** Count of changed files detected under {@link CommitBackOptions.paths}. */
	readonly changedFiles: number;
	/** Whether a commit was created and pushed. */
	readonly committed: boolean;
	/** New commit sha, present only when {@link CommitBackResult.committed}. */
	readonly sha?: string;
}

/**
 * Commit the changes under `paths` onto the latest `branch` tip and push them,
 * retrying when the tip moves under a concurrent push.
 *
 * @param deps - Injected `git` runner.
 * @param options - Branch, paths, message, author identity, and attempt cap.
 * @returns Whether a commit was pushed, how many files changed, and the new sha.
 * @rejects When the push is still rejected after `maxAttempts` reflow attempts.
 */
export async function commitBack(
	deps: CommitBackDeps,
	options: CommitBackOptions,
): Promise<CommitBackResult> {
	const diff = await deps.git(["diff", "--name-only", "--", ...options.paths]);
	const changedFiles = parseChangedFiles(diff.stdout);

	if (changedFiles.length === 0) {
		return { changedFiles: 0, committed: false };
	}

	const stash = await deps.git(["stash", "create"]);
	const stashSha = stash.stdout.trim();
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const sha = await reflowOntoTip(deps, { ...options, stashSha });
		if (sha !== undefined) {
			return { changedFiles: changedFiles.length, committed: true, sha };
		}
	}

	throw new Error(
		`commit-back: push to ${options.branch} rejected after ${String(maxAttempts)} attempts`,
	);
}

/**
 * Reset onto the latest branch tip, restore the generated paths from the stash
 * commit, commit, and push once.
 *
 * @param deps - Injected `git` runner.
 * @param plan - Commit options plus the `stashSha` capturing the generated files.
 * @returns The new commit sha on a successful push, or `undefined` when the push
 * was rejected (the tip moved).
 */
async function reflowOntoTip(
	deps: CommitBackDeps,
	plan: CommitBackOptions & { readonly stashSha: string },
): Promise<string | undefined> {
	const { stashSha, ...options } = plan;
	await deps.git(["fetch", "origin", options.branch]);
	await deps.git(["checkout", "-f", "-B", options.branch, "FETCH_HEAD"]);
	await deps.git(["checkout", stashSha, "--", ...options.paths]);
	await deps.git(["add", "--", ...options.paths]);
	await deps.git([
		"-c",
		`user.name=${options.authorName}`,
		"-c",
		`user.email=${options.authorEmail}`,
		"commit",
		"--message",
		options.message,
	]);
	const head = await deps.git(["rev-parse", "HEAD"]);
	const push = await deps.git(["push", "origin", `HEAD:refs/heads/${options.branch}`]);
	return push.code === 0 ? head.stdout.trim() : undefined;
}

function parseChangedFiles(stdout: string): Array<string> {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}
