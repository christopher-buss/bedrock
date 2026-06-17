import { spawnSync } from "node:child_process";
import process from "node:process";

interface SpawnResult {
	readonly error?: Error;
	readonly status: null | number;
	readonly stdout?: string;
}

type SpawnFunc = (command: string, args: ReadonlyArray<string>) => SpawnResult;

interface RunDeps {
	readonly platform: NodeJS.Platform;
	readonly spawn: SpawnFunc;
	readonly stdin: string;
}

interface RunResult {
	readonly code: 0 | 1;
}

/**
 * Resolve the worktrunk executable for the current platform.
 *
 * On Windows, plain `wt` can resolve to Windows Terminal's `wt.exe` shim
 * instead of worktrunk; `git-wt.exe` is unambiguous. Elsewhere `wt` is correct.
 * @param platform - Node platform identifier (e.g. `process.platform`).
 * @returns The executable name to spawn.
 */
function worktrunkBinary(platform: NodeJS.Platform): string {
	return platform === "win32" ? "git-wt.exe" : "wt";
}

function buildWtArgs(worktreePath: string): ReadonlyArray<string> {
	// --force removes a dirty worktree instead of failing; --foreground blocks
	// until cleanup finishes; --yes skips approval in this non-interactive hook.
	return ["remove", worktreePath, "--foreground", "--force", "--yes"];
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

function readJsonStringField(raw: string, key: string): string | undefined {
	const parsed = tryParseJson(raw);
	if (!isJsonObject(parsed)) {
		return undefined;
	}

	const value = readString(parsed, key);
	return value !== undefined && value !== "" ? value : undefined;
}

function parseWorktreePath(raw: string): string | undefined {
	return readJsonStringField(raw, "worktree_path");
}

function removeWorktree(spawn: SpawnFunc, binary: string, worktreePath: string): boolean {
	const result = spawn(binary, buildWtArgs(worktreePath));
	if (result.error !== undefined) {
		console.error(
			`worktree-remove: failed to spawn ${binary} (${result.error.message}); is worktrunk installed?`,
		);
		return false;
	}

	if (result.status !== 0) {
		console.error(
			`worktree-remove: ${binary} remove ${worktreePath} failed (exit ${result.status})`,
		);
		return false;
	}

	return true;
}

function runWorktreeRemove(deps: RunDeps): RunResult {
	const worktreePath = parseWorktreePath(deps.stdin);
	if (worktreePath === undefined) {
		console.error("worktree-remove: missing `worktree_path` in stdin payload");
		return { code: 1 };
	}

	const binary = worktrunkBinary(deps.platform);
	return removeWorktree(deps.spawn, binary, worktreePath) ? { code: 0 } : { code: 1 };
}

async function readStdin(): Promise<string> {
	let data = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		data += chunk;
	}

	return data;
}

function spawnWt(command: string, args: ReadonlyArray<string>): SpawnResult {
	const result = spawnSync(command, [...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		windowsHide: true,
	});
	return {
		error: result.error,
		status: result.status,
		stdout: result.stdout,
	};
}

/**
 * Entry point: reads stdin, runs the remove flow, and forwards the exit code.
 * Wired to the WorktreeRemove hook in `.claude/settings.json`.
 */
async function main(): Promise<void> {
	const result = runWorktreeRemove({
		platform: process.platform,
		spawn: spawnWt,
		stdin: await readStdin(),
	});
	process.exit(result.code);
}

if (import.meta.main) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}
