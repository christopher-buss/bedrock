import {
	buildMutateArgs,
	filterMutableFiles,
	groupByPackage,
	isTypesOnlyModule,
	parseDiff,
} from "@bedrock/testing/stryker-diff";

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function readGitDiff(): string {
	const baseRef = process.env["MUTATE_BASE_REF"];
	const diffTarget = baseRef === undefined || baseRef === "" ? "HEAD" : `${baseRef}...HEAD`;
	const result = spawnSync("git", ["diff", "--unified=0", diffTarget], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`git diff failed with status ${String(result.status)}: ${result.stderr}`);
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
	const statuses = Array.from(grouped, ([packageDirectory, files]) => {
		const args = buildMutateArgs(files);
		console.log(`\n→ Running Stryker in ${packageDirectory}`);
		return spawnSync("pnpm", ["exec", "stryker", "run", "stryker.config.ts", ...args], {
			cwd: packageDirectory,
			stdio: "inherit",
		}).status;
	});
	return statuses.some((status) => status !== 0);
}

function reportReject(reason: { kind: string; path: string }): void {
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

	const mutable = filterMutableFiles(parsed.files).filter((file) => {
		return !isTypesOnlyModule(readFileSync(file.path, "utf8"));
	});
	if (mutable.length === 0) {
		console.log("No modified files — nothing to mutate.");
		return;
	}

	const packageDirectories = await discoverStrykerPackages();
	const grouped = groupByPackage(mutable, packageDirectories);

	if (grouped.size === 0) {
		console.log("No mutable files under any Stryker-configured package.");
		return;
	}

	const hasFailed = runStrykerForEach(grouped);
	if (hasFailed) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
