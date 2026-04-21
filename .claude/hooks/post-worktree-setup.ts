#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

interface HookPayload {
	// eslint-disable-next-line flawless/naming-convention -- matches Claude Code hook payload shape
	tool_response?: {
		cwd?: string;
		directory?: string;
		path?: string;
		worktreePath?: string;
	};
}

async function readStdin(): Promise<string> {
	let data = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		data += chunk;
	}

	return data;
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function newestWorktreeDirectory(projectDirectory: string): string | undefined {
	const parent = join(projectDirectory, ".claude", "worktrees");
	let entries;
	try {
		entries = readdirSync(parent, { withFileTypes: true });
	} catch {
		return undefined;
	}

	const directories = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const path = join(parent, entry.name);
			return { mtime: statSync(path).mtimeMs, path };
		})
		.sort((a, b) => b.mtime - a.mtime);
	return directories[0]?.path;
}

function isJsonObject(value: JSONValue | undefined): value is JSONObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(object: JSONObject, key: string): string | undefined {
	const value = object[key];
	return typeof value === "string" ? value : undefined;
}

function tryParseJson(raw: string): JSONValue | undefined {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function parsePayload(raw: string): HookPayload {
	if (raw === "") {
		return {};
	}

	const parsed = tryParseJson(raw);
	if (!isJsonObject(parsed)) {
		return {};
	}

	const response = parsed["tool_response"];
	if (!isJsonObject(response)) {
		return {};
	}

	return {
		tool_response: {
			cwd: readString(response, "cwd"),
			directory: readString(response, "directory"),
			path: readString(response, "path"),
			worktreePath: readString(response, "worktreePath"),
		},
	};
}

function resolveWorktree(payload: HookPayload): string | undefined {
	const response = payload.tool_response ?? {};
	const hinted = response.path ?? response.worktreePath ?? response.cwd ?? response.directory;
	if (hinted !== undefined && isDirectory(hinted)) {
		return hinted;
	}

	const projectDirectory = process.env["CLAUDE_PROJECT_DIR"];
	if (projectDirectory === undefined || projectDirectory === "") {
		return undefined;
	}

	const fallback = newestWorktreeDirectory(projectDirectory);
	return fallback !== undefined && isDirectory(fallback) ? fallback : undefined;
}

function runSetup(worktree: string): number {
	const steps: Array<[string, Array<string>]> = [
		["mise", ["trust"]],
		["mise", ["install"]],
		["hk", ["install", "--mise"]],
		["pnpm", ["install"]],
	];
	for (const [command, args] of steps) {
		const result = spawnSync(command, args, {
			cwd: worktree,
			shell: process.platform === "win32",
			stdio: "inherit",
		});
		if (result.status !== 0) {
			console.error(`post-worktree-setup: ${command} ${args.join(" ")} failed`);
			return result.status ?? 1;
		}
	}

	return 0;
}

async function main(): Promise<void> {
	const payload = parsePayload(await readStdin());
	const worktree = resolveWorktree(payload);
	if (worktree === undefined) {
		console.error("post-worktree-setup: could not locate new worktree path");
		return;
	}

	console.error(`post-worktree-setup: setting up ${worktree}`);
	const status = runSetup(worktree);
	if (status !== 0) {
		process.exit(status);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
