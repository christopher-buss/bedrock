import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GitExec, GitResult } from "./git.ts";

/** Generous output ceiling so large `git diff` output is never truncated. */
const MAX_BUFFER = 64 * 1024 * 1024;

// eslint-disable-next-line ts/strict-void-return -- promisify resolves execFile through its dedicated `util.promisify.custom` overload; the ChildProcess return is consumed by promisify, not a discarded value.
const execFileAsync = promisify(execFile);

/** Dependencies for {@link createGitExec}. */
export interface GitExecDeps {
	/** Git executable to run; defaults to `git` resolved on the `PATH`. */
	readonly binary?: string;
	/** Working directory git runs in; defaults to the process working directory. */
	readonly cwd?: string;
}

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
export function classifyExecFailure(failure: {
	readonly code?: number | string | undefined;
	readonly stderr?: string | undefined;
	readonly stdout?: string | undefined;
}): GitResult {
	return {
		code: typeof failure.code === "number" ? failure.code : 1,
		stderr: failure.stderr ?? "",
		stdout: failure.stdout ?? "",
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
export function createGitExec(deps: GitExecDeps = {}): GitExec {
	const binary = deps.binary ?? "git";
	return async (args) => {
		try {
			const { stderr, stdout } = await execFileAsync(binary, [...args], {
				cwd: deps.cwd,
				maxBuffer: MAX_BUFFER,
			});
			return { code: 0, stderr, stdout };
		} catch (err) {
			return classifyExecFailure(err as Parameters<typeof classifyExecFailure>[0]);
		}
	};
}
