import type { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const TOKEN = process.env["GITHUB_TOKEN"];
const API_KEY = process.env["ROBLOX_API_KEY"];
const GIST_ID = process.env["BEDROCK_TEST_GIST_ID"];
const PLACE_ID_ENV = process.env["ROBLOX_TEST_PLACE_ID"];

const HAS_SECRETS =
	TOKEN !== undefined &&
	API_KEY !== undefined &&
	GIST_ID !== undefined &&
	PLACE_ID_ENV !== undefined;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PLACE = join(HERE, "fixtures", "place.rbxlx");
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const BIN_ENTRY = join(REPO_ROOT, "packages", "bedrock", "src", "cli", "run.ts");

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

async function deleteGistFile(filename: string): Promise<void> {
	assert(TOKEN !== undefined);
	assert(GIST_ID !== undefined);
	await fetch(`https://api.github.com/gists/${GIST_ID}`, {
		body: JSON.stringify({ files: { [filename]: null } }),
		headers: {
			"Accept": "application/vnd.github+json",
			"Authorization": `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
			"User-Agent": "bedrock",
			"X-GitHub-Api-Version": "2026-03-10",
		},
		method: "PATCH",
	});
}

describe("bedrock diff bin against real gist + open cloud", () => {
	it.skipIf(!HAS_SECRETS)(
		"should preview pending changes against a fresh env and exit 0",
		async () => {
			expect.assertions(3);

			assert(TOKEN !== undefined);
			assert(API_KEY !== undefined);
			assert(GIST_ID !== undefined);
			assert(PLACE_ID_ENV !== undefined);

			const environment = `cli-diff-smoke-${String(Date.now())}`;
			const project = await mkdtemp(join(tmpdir(), "bedrock-cli-diff-smoke-"));
			const configPath = join(project, "bedrock.config.ts");

			const configSource = [
				'import { defineConfig } from "@bedrock/core";',
				"",
				"export default defineConfig({",
				"    environments: {",
				`        "${environment}": {`,
				'            places: { "smoke-place": {',
				`                placeId: "${PLACE_ID_ENV}",`,
				"            } },",
				"        },",
				"    },",
				"    places: {",
				'        "smoke-place": {',
				`            filePath: ${JSON.stringify(FIXTURE_PLACE)},`,
				"        },",
				"    },",
				`    state: { backend: "gist", gistId: "${GIST_ID}" },`,
				"});",
				"",
			].join("\n");
			await writeFile(configPath, configSource, "utf8");

			try {
				const result = await runBin(
					["diff", "--env", environment, "--config", configPath],
					project,
				);

				expect(
					result.code,
					`bin exited ${String(result.code)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
				).toBe(0);
				expect(result.stdout).toContain(`Pending changes for "${environment}"`);
				expect(result.stdout).toContain("+ place:smoke-place");
			} finally {
				await deleteGistFile(`state.${environment}.json`);
				await rm(project, { force: true, recursive: true });
			}
		},
		120_000,
	);
});
