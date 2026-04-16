import { buildMutateArgs, groupByPackage, parseDiff } from "@bedrock/testing/stryker-diff";

import { spawnSync } from "node:child_process";
import { glob } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function readGitDiff(): string {
	const result = spawnSync("git", ["diff", "--unified=0", "HEAD"], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(
			`git diff hasFailed with status ${String(result.status)}: ${result.stderr}`,
		);
	}

	return result.stdout;
}

async function discoverStrykerPackages(): Promise<Array<string>> {
	const directories: Array<string> = [];
	for await (const configPath of glob("packages/*/stryker.config.ts")) {
		directories.push(path.dirname(configPath));
	}

	return directories;
}

function runStrykerForEach(
	grouped: Map<
		string,
		Array<{ hunks: Array<{ endLine: number; startLine: number }>; path: string }>
	>,
): boolean {
	let hasFailed = false;
	for (const [packageDirectory, files] of grouped) {
		const args = buildMutateArgs(files);
		console.log(`\n→ Running Stryker in ${packageDirectory}`);
		const result = spawnSync("pnpm", ["exec", "stryker", "run", ...args], {
			cwd: packageDirectory,
			stdio: "inherit",
		});
		if (result.status !== 0) {
			hasFailed = true;
		}
	}

	return hasFailed;
}

function reportReject(reason: { from?: string; kind: string; path?: string; to?: string }): void {
	if (reason.kind === "rename") {
		console.error(`error: rename not supported (${reason.from} -> ${reason.to})`);
		return;
	}

	console.error(`error: ${reason.kind} not supported (${reason.path})`);
}

async function main(): Promise<void> {
	const raw = readGitDiff();
	const parsed = parseDiff(raw);

	if (parsed.kind === "reject") {
		for (const reason of parsed.reasons) {
			reportReject(reason);
		}

		process.exit(2);
	}

	if (parsed.files.length === 0) {
		console.log("No modified files — nothing to mutate.");
		return;
	}

	const packageDirectories = await discoverStrykerPackages();
	const grouped = groupByPackage(parsed.files, packageDirectories);

	if (grouped.size === 0) {
		console.log("No mutable files under any Stryker-configured package.");
		return;
	}

	const hasFailed = runStrykerForEach(grouped);
	if (hasFailed) {
		process.exit(1);
	}
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
