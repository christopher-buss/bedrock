/**
 * Outcome of running a single `git` invocation: the process exit code plus its
 * captured stdout/stderr. Adapters resolve (never reject) so the caller decides
 * what a non-zero code means in context.
 */
export interface GitResult {
	/** Process exit code; `0` is success. */
	readonly code: number;
	/** Captured standard error. */
	readonly stderr: string;
	/** Captured standard output. */
	readonly stdout: string;
}

/**
 * Runs one `git` command with the given argument vector and resolves with its
 * {@link GitResult}. The injection seam for commit-back: the real adapter shells
 * `git` via `node:child_process`; tests supply a fake transcript.
 */
export type GitExec = (args: ReadonlyArray<string>) => Promise<GitResult>;
