import { spawnSync } from "node:child_process";
import process from "node:process";

async function readStdin(): Promise<string> {
	let data = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		data += chunk;
	}

	return data;
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

function readName(raw: string): string | undefined {
	const parsed = tryParseJson(raw);
	if (!isJsonObject(parsed)) {
		return undefined;
	}

	return readString(parsed, "name");
}

function resolveProjectDirectory(): string | undefined {
	const directory = process.env["CLAUDE_PROJECT_DIR"];
	return directory !== undefined && directory !== "" ? directory : undefined;
}

function createWorktree(projectDirectory: string, name: string): number {
	const result = spawnSync("wt", ["switch", "--create", name, "--no-cd", "--yes"], {
		cwd: projectDirectory,
		shell: process.platform === "win32",
		// Child stdout goes to our stderr so only the resolved worktree path
		// reaches parent stdout.
		stdio: ["ignore", 2, 2],
	});
	if (result.error !== undefined) {
		console.error(
			`worktree-create: failed to spawn wt (${result.error.message}); is worktrunk installed?`,
		);
	}

	return result.status ?? 1;
}

function findWorktreePath(projectDirectory: string, branch: string): string | undefined {
	const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
		cwd: projectDirectory,
		encoding: "utf8",
	});
	if (result.error !== undefined) {
		console.error(`worktree-create: failed to spawn git (${result.error.message})`);
		return undefined;
	}

	if (result.status !== 0) {
		return undefined;
	}

	const target = `branch refs/heads/${branch}`;
	let lastPath: string | undefined;
	for (const line of result.stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			lastPath = line.slice("worktree ".length);
		} else if (line === target) {
			return lastPath;
		}
	}

	return undefined;
}

async function main(): Promise<void> {
	const name = readName(await readStdin());
	if (name === undefined) {
		console.error("worktree-create: missing `name` in stdin payload");
		process.exit(1);
	}

	const projectDirectory = resolveProjectDirectory();
	if (projectDirectory === undefined) {
		console.error("worktree-create: CLAUDE_PROJECT_DIR not set");
		process.exit(1);
	}

	const status = createWorktree(projectDirectory, name);
	if (status !== 0) {
		console.error(`worktree-create: wt switch --create ${name} failed`);
		process.exit(status);
	}

	const path = findWorktreePath(projectDirectory, name);
	if (path === undefined) {
		console.error(`worktree-create: could not resolve worktree path for branch ${name}`);
		process.exit(1);
	}

	process.stdout.write(`${path}\n`);
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
