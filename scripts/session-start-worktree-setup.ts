import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import process from "node:process";

// Workaround for Claude Code issue #29716
// (https://github.com/anthropics/claude-code/issues/29716): the desktop
// app's "create in worktree" UI does not fire WorktreeCreate hooks.
// SessionStart fires reliably in both desktop and CLI environments, so we
// run the worktrunk post-create chain (mise trust, mise install, pnpm
// install) here whenever a session starts in a fresh worktree without
// node_modules.

async function drainStdin(): Promise<void> {
	process.stdin.setEncoding("utf8");
	for await (const _ of process.stdin) {
		// SessionStart payload is unused; drain so the parent pipe closes
		// cleanly.
	}
}

function gitOutput(args: ReadonlyArray<string>): string | undefined {
	const result = spawnSync("git", [...args], { encoding: "utf8" });
	if (result.error !== undefined || result.status !== 0) {
		return undefined;
	}

	return result.stdout.trim();
}

function isInsideWorkTree(): boolean {
	return gitOutput(["rev-parse", "--is-inside-work-tree"]) === "true";
}

function isInsideSecondaryWorktree(): boolean {
	const gitDirectory = gitOutput(["rev-parse", "--git-dir"]);
	const commonDirectory = gitOutput(["rev-parse", "--git-common-dir"]);
	if (gitDirectory === undefined || commonDirectory === undefined) {
		return false;
	}

	try {
		return realpathSync(gitDirectory) !== realpathSync(commonDirectory);
	} catch {
		return false;
	}
}

function runWorktrunkPostCreate(): number {
	const result = spawnSync("wt", ["hook", "post-create", "--yes"], {
		stdio: "inherit",
	});
	if (result.error !== undefined) {
		console.error(
			`session-start-worktree-setup: failed to spawn wt (${result.error.message}); is worktrunk installed?`,
		);
		return 1;
	}

	if (result.status !== 0) {
		console.error("session-start-worktree-setup: wt hook post-create failed");
		return result.status ?? 1;
	}

	return 0;
}

async function main(): Promise<void> {
	await drainStdin();

	if (!isInsideWorkTree() || !isInsideSecondaryWorktree()) {
		return;
	}

	if (existsSync("node_modules")) {
		return;
	}

	const status = runWorktrunkPostCreate();
	if (status !== 0) {
		process.exit(status);
	}
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
