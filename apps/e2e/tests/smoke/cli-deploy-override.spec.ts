import type { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const BIN_ENTRY = join(REPO_ROOT, "packages", "bedrock", "src", "cli", "run.ts");
const FIXTURES = join(HERE, "fixtures", "deploy-override");
const ECHO_OVERRIDE = join(FIXTURES, "echo.ts");
const FAILING_OVERRIDE = join(FIXTURES, "exit-non-zero.ts");

interface SpawnResult {
	readonly code: number;
	readonly stderr: string;
	readonly stdout: string;
}

async function runBin(args: ReadonlyArray<string>, cwd: string): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", ["--conditions", "source", BIN_ENTRY, ...args], {
			cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolve({ code: code ?? -1, stderr, stdout });
		});
	});
}

async function createProject(overrideFixture: string): Promise<string> {
	const project = await mkdtemp(join(tmpdir(), "bedrock-override-e2e-"));
	await writeFile(
		join(project, "bedrock.config.json"),
		`${JSON.stringify({ environments: { production: {} } }, undefined, 2)}\n`,
		"utf8",
	);
	await mkdir(join(project, ".bedrock"));
	await copyFile(overrideFixture, join(project, ".bedrock", "deploy.ts"));
	return project;
}

describe("bedrock deploy override via the real cli", () => {
	it("should discover .bedrock/deploy.ts, execute it with the spawn protocol, and exit 0", async () => {
		expect.assertions(4);

		const project = await createProject(ECHO_OVERRIDE);
		try {
			const result = await runBin(["deploy", "--env", "production"], project);

			expect(
				result.code,
				`bin exited ${String(result.code)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
			).toBe(0);
			expect(result.stdout).toContain("bedrock override deploy ran");
			expect(
				JSON.parse(await readFile(join(project, "override-ran.json"), "utf8")),
			).toStrictEqual({ cli: "1", flags: ["--env", "production"], script: "deploy.ts" });
			expect(result.stdout).toContain("deploy succeeded");
		} finally {
			await rm(project, { force: true, recursive: true });
		}
	}, 30_000);

	it("should propagate a non-zero override exit as cli exit 1", async () => {
		expect.assertions(2);

		const project = await createProject(FAILING_OVERRIDE);
		try {
			const result = await runBin(["deploy", "--env", "production"], project);

			expect(result.code).toBe(1);
			expect(`${result.stdout}${result.stderr}`).toContain(
				"production: override exited with code 3",
			);
		} finally {
			await rm(project, { force: true, recursive: true });
		}
	}, 30_000);
});
