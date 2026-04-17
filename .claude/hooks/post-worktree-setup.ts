#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface ToolResponse {
	cwd?: string;
	directory?: string;
	path?: string;
	worktreePath?: string;
}

interface HookPayload {
	tool_response?: ToolResponse;
}

async function readStdin(): Promise<string> {
	let data = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) data += chunk;
	return data;
}

function newestWorktreeDir(projectDir: string): string | null {
	const parent = join(projectDir, ".claude", "worktrees");
	let entries;
	try {
		entries = readdirSync(parent, { withFileTypes: true });
	} catch {
		return null;
	}
	const dirs = entries
		.filter((e) => e.isDirectory())
		.map((e) => {
			const path = join(parent, e.name);
			return { path, mtime: statSync(path).mtimeMs };
		})
		.sort((a, b) => b.mtime - a.mtime);
	return dirs[0]?.path ?? null;
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

async function main(): Promise<void> {
	const raw = await readStdin();
	let payload: HookPayload = {};
	try {
		if (raw) payload = JSON.parse(raw) as HookPayload;
	} catch {
		// treat as empty payload
	}
	const r = payload.tool_response ?? {};
	let worktree = r.path ?? r.worktreePath ?? r.cwd ?? r.directory ?? null;

	if (!worktree || !isDir(worktree)) {
		const projectDir = process.env.CLAUDE_PROJECT_DIR;
		if (!projectDir) {
			console.error("post-worktree-setup: CLAUDE_PROJECT_DIR not set");
			process.exit(0);
		}
		worktree = newestWorktreeDir(projectDir);
	}

	if (!worktree || !isDir(worktree)) {
		console.error("post-worktree-setup: could not locate new worktree path");
		process.exit(0);
	}

	console.error(`post-worktree-setup: setting up ${worktree}`);

	const steps: Array<[string, Array<string>]> = [
		["mise", ["trust"]],
		["mise", ["install"]],
		["pnpm", ["install"]],
	];
	for (const [cmd, args] of steps) {
		const result = spawnSync(cmd, args, {
			cwd: worktree,
			shell: process.platform === "win32",
			stdio: "inherit",
		});
		if (result.status !== 0) {
			console.error(`post-worktree-setup: ${cmd} ${args.join(" ")} failed`);
			process.exit(result.status ?? 1);
		}
	}
}

await main();
