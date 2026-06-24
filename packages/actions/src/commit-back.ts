import type { GitExec, GitResult } from "./git.ts";

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
 * The result of a single reflow attempt: a `committed` sha that was pushed, a
 * `converged` no-op (the tip already carries the generated files), or a
 * `rejected` push (the tip moved) that the caller retries.
 */
type ReflowOutcome =
	| { readonly kind: "committed"; readonly sha: string }
	| { readonly kind: "converged" }
	| { readonly kind: "rejected" };

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
	// `git status --porcelain` (not `git diff`) so newly created files — a first
	// deploy under codegen.output — count as changes, not just tracked edits.
	const status = await runGit(deps, ["status", "--porcelain", "--", ...options.paths]);
	const changedFiles = parseChangedFiles(status.stdout);

	if (changedFiles.length === 0) {
		return { changedFiles: 0, committed: false };
	}

	// Stage first so `git stash create` snapshots untracked files too (it would
	// otherwise ignore them, yielding an empty stash on an all-new-files run).
	await runGit(deps, ["add", "--", ...options.paths]);
	const stash = await runGit(deps, ["stash", "create"]);
	const stashSha = stash.stdout.trim();
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const outcome = await reflowOntoTip(deps, { ...options, stashSha });
		if (outcome.kind === "committed") {
			return { changedFiles: changedFiles.length, committed: true, sha: outcome.sha };
		}

		if (outcome.kind === "converged") {
			// A concurrent run pushed identical generated files first, so the tip
			// already carries them. The desired state is realized; report no new
			// commit rather than failing on an empty `git commit`.
			return { changedFiles: changedFiles.length, committed: false };
		}
	}

	throw new Error(
		`commit-back: push to ${options.branch} rejected after ${String(maxAttempts)} attempts`,
	);
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
async function runGit(deps: CommitBackDeps, args: ReadonlyArray<string>): Promise<GitResult> {
	const result = await deps.git(args);
	if (result.code !== 0) {
		throw new Error(`commit-back: git ${args.join(" ")} failed with exit code ${result.code}`);
	}

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
async function reflowOntoTip(
	deps: CommitBackDeps,
	plan: CommitBackOptions & { readonly stashSha: string },
): Promise<ReflowOutcome> {
	const { stashSha, ...options } = plan;
	await runGit(deps, ["fetch", "origin", options.branch]);
	await runGit(deps, ["checkout", "-f", "-B", options.branch, "FETCH_HEAD"]);
	await runGit(deps, ["checkout", stashSha, "--", ...options.paths]);
	await runGit(deps, ["add", "--", ...options.paths]);
	// `--quiet` exits 0 when nothing is staged — the tip already matches the
	// generated files, so committing would fail with "nothing to commit". Treat
	// it as convergence instead. A genuine diff failure surfaces at the commit.
	const staged = await deps.git(["diff", "--cached", "--quiet", "--", ...options.paths]);
	if (staged.code === 0) {
		return { kind: "converged" };
	}

	await runGit(deps, [
		"-c",
		`user.name=${options.authorName}`,
		"-c",
		`user.email=${options.authorEmail}`,
		"commit",
		"--message",
		options.message,
	]);
	const head = await runGit(deps, ["rev-parse", "HEAD"]);
	// Push is the one command whose non-zero exit is expected (a moving tip):
	// surface it as a retry signal rather than a thrown error.
	const push = await deps.git(["push", "origin", `HEAD:refs/heads/${options.branch}`]);
	return push.code === 0 ? { kind: "committed", sha: head.stdout.trim() } : { kind: "rejected" };
}

function parseChangedFiles(stdout: string): Array<string> {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}
