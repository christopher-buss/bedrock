import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

interface SpawnResult {
	readonly error?: Error;
	readonly status: null | number;
	readonly stdout?: string;
}

type SpawnFunc = (command: string, args: ReadonlyArray<string>) => SpawnResult;

interface RunDeps {
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
	readonly platform: NodeJS.Platform;
	readonly spawn: (projectDirectory: string) => SpawnFunc;
	readonly stdin: string;
}

interface RunResult {
	readonly code: 0 | 1;
	readonly stdout?: string;
}

const REMOTE_PREFIX = "origin/";
const DEFAULT_REMOTE_BASE = `${REMOTE_PREFIX}main`;
const STDOUT_PREVIEW_LIMIT = 200;

function buildWtArgs(name: string, base: string): ReadonlyArray<string> {
	// No --no-hooks: wt runs pre-start (blocking) and post-start (background)
	// during create, so a fresh worktree is set up in one step. --base cuts the
	// branch from the fetched remote default, never a stale local checkout.
	return ["switch", "--create", name, "--base", base, "--no-cd", "--yes", "--format", "json"];
}

/**
 * Resolve the remote default-branch ref new worktrees should branch from.
 *
 * Reads `origin/HEAD`; falls back to `origin/main` when it is unset.
 * @param spawn - Spawn function bound to the project directory.
 * @returns A remote-tracking ref such as `origin/main`.
 */
function resolveRemoteBase(spawn: SpawnFunc): string {
	const result = spawn("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"]);
	const ref = (result.stdout ?? "").trim();
	return ref.startsWith(REMOTE_PREFIX) ? ref : DEFAULT_REMOTE_BASE;
}

/**
 * Fetch the remote default branch so the worktree branches from its latest tip.
 *
 * Best-effort: a failed fetch leaves the last-fetched ref in place, which
 * still exists locally, so creation continues.
 * @param spawn - Spawn function bound to the project directory.
 * @param base - Remote-tracking ref from {@link resolveRemoteBase}.
 */
function fetchRemoteBase(spawn: SpawnFunc, base: string): void {
	spawn("git", ["fetch", "origin", base.slice(REMOTE_PREFIX.length), "--quiet"]);
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

function extractPath(stdout: string): string | undefined {
	// Hooks run during create now, so stdout interleaves progress with the JSON
	// result; scan line by line for the first object carrying a path.
	for (const line of stdout.split("\n")) {
		const path = readJsonStringField(line, "path");
		if (path !== undefined) {
			return path;
		}
	}

	return undefined;
}

function parseName(raw: string): string | undefined {
	return readJsonStringField(raw, "name");
}

/**
 * Resolve the project root for the worktree operation.
 *
 * The desktop "create in worktree" flow runs this hook command without
 * substituting `${CLAUDE_PROJECT_DIR}`, so the env var can be absent. Fall
 * back to the hook's working directory (the project root) so worktree
 * creation still resolves the right repo.
 * @param environment - Process environment to read `CLAUDE_PROJECT_DIR` from.
 * @param cwd - Working directory to fall back to when the env var is unset.
 * @returns The resolved project root directory.
 */
function resolveProjectDirectory(environment: NodeJS.ProcessEnv, cwd: string): string {
	const directory = environment["CLAUDE_PROJECT_DIR"];
	return directory !== undefined && directory !== "" ? directory : cwd;
}

/**
 * Run a command and capture its stdout via a temp file rather than a pipe.
 *
 * `wt switch --create` backgrounds the post-start build, which inherits the
 * stdout handle. With a pipe, `spawnSync` blocks on EOF until that build exits
 * (or the hook times out): the worktree is created but its path is never
 * returned, so Claude Desktop hangs on "starting session". A file handle has no
 * EOF wait, so `spawnSync` returns as soon as `wt` itself exits.
 * @param command - Executable to run.
 * @param args - Arguments for the command.
 * @param cwd - Working directory for the command.
 * @param outFile - Path the command's stdout is redirected to.
 * @returns The spawn result with stdout read back from the file.
 */
function captureStdout(
	command: string,
	args: ReadonlyArray<string>,
	cwd: string,
	outFile: string,
): SpawnResult {
	const handle = openSync(outFile, "w");
	let result: ReturnType<typeof spawnSync>;
	try {
		result = spawnSync(command, [...args], {
			cwd,
			stdio: ["ignore", handle, "inherit"],
			windowsHide: true,
		});
	} finally {
		closeSync(handle);
	}

	// Read after closing the write handle. spawnSync has already waited for the
	// child to exit, so every write is flushed and the file is complete.
	return {
		error: result.error,
		status: result.status,
		stdout: readFileSync(outFile, "utf8"),
	};
}

function createWorktree(spawn: SpawnFunc, binary: string, name: string): string | undefined {
	const base = resolveRemoteBase(spawn);
	fetchRemoteBase(spawn, base);

	const result = spawn(binary, buildWtArgs(name, base));
	if (result.error !== undefined) {
		console.error(
			`worktree-create: failed to spawn ${binary} (${result.error.message}); is worktrunk installed?`,
		);
		return undefined;
	}

	if (result.status !== 0) {
		console.error(
			`worktree-create: ${binary} switch --create ${name} failed (exit ${result.status})`,
		);
		return undefined;
	}

	const stdout = result.stdout ?? "";
	const path = extractPath(stdout);
	if (path === undefined) {
		const preview = stdout.slice(0, STDOUT_PREVIEW_LIMIT);
		console.error(
			`worktree-create: wt returned no path in JSON output. stdout preview: ${JSON.stringify(preview)}`,
		);
		return undefined;
	}

	return path;
}

function runWorktreeCreate(deps: RunDeps): RunResult {
	const name = parseName(deps.stdin);
	if (name === undefined) {
		console.error("worktree-create: missing `name` in stdin payload");
		return { code: 1 };
	}

	const projectDirectory = resolveProjectDirectory(deps.env, deps.cwd);
	const binary = worktrunkBinary(deps.platform);
	const path = createWorktree(deps.spawn(projectDirectory), binary, name);
	if (path === undefined) {
		return { code: 1 };
	}

	return { code: 0, stdout: `${path}\n` };
}

async function readStdin(): Promise<string> {
	let data = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		data += chunk;
	}

	return data;
}

function spawnWt(projectDirectory: string): SpawnFunc {
	return (command, args) => {
		const directory = mkdtempSync(join(tmpdir(), "wt-create-"));
		try {
			return captureStdout(command, args, projectDirectory, join(directory, "stdout"));
		} finally {
			// Best-effort: the background post-start build inherits the temp file
			// handle and may hold it open on Windows; leave any leftover to the
			// OS temp sweeper rather than failing the hook.
			try {
				rmSync(directory, { force: true, recursive: true });
			} catch {
				// ignore
			}
		}
	};
}

/**
 * Entry point: reads stdin, runs the create flow, and forwards the result to
 * stdout/exit. Wired to the WorktreeCreate hook in `.claude/settings.json`.
 */
async function main(): Promise<void> {
	const result = runWorktreeCreate({
		cwd: process.cwd(),
		env: process.env,
		platform: process.platform,
		spawn: spawnWt,
		stdin: await readStdin(),
	});
	if (result.stdout !== undefined) {
		process.stdout.write(result.stdout);
	}

	process.exit(result.code);
}

if (import.meta.main) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}
