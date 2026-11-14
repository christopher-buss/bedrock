#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import process from "node:process";

/**
 * Runs a command without the git env vars a hook exports.
 *
 * A hook exports `GIT_DIR`, which makes every nested `git rev-parse
 * --show-toplevel` resolve to the cwd instead of the worktree root. Clearing
 * the vars restores worktree discovery from the cwd. This replaces a shell
 * `unset`, which `cmd.exe` does not have.
 *
 * Usage: `bun scripts/without-git-environment.ts <command> [args...]`.
 */

const GIT_ENV = new Set(["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]);

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
	console.error("Usage: bun scripts/without-git-environment.ts <command> [args...]");
	process.exit(1);
}

// Windows env names are case-insensitive, so compare them upper-cased.
const environment = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !GIT_ENV.has(key.toUpperCase())),
);

// `shell` resolves `.cmd` shims such as `pnpm` on Windows.
const result = spawnSync(command, args, { env: environment, shell: true, stdio: "inherit" });
process.exit(result.status ?? 1);
