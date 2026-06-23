import type { GitExec } from "./git.ts";

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
 * Commit the changes under `paths` onto `branch` and push them.
 *
 * @param deps - Injected `git` runner.
 * @param options - Branch, paths, message, and author identity.
 * @returns Whether a commit was pushed, how many files changed, and the new sha.
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
	await deps.git(["push", "origin", `HEAD:refs/heads/${options.branch}`]);

	return { changedFiles: changedFiles.length, committed: true, sha: head.stdout.trim() };
}

function parseChangedFiles(stdout: string): Array<string> {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}
