import { detectLute, luteRequirementFailure } from "@bedrock-rbx/testing/lute";
import {
	buildMutateArgs,
	filterMutableFiles,
	findPackagesWithChangedSpecs,
	groupByPackage,
	isTypesOnlyModule,
	parseDiff,
} from "@bedrock-rbx/testing/stryker-diff";

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const LUTE_HELPER_SPECIFIER = "@bedrock-rbx/testing/lute";

function readGitDiff(): string {
	// The remote-offload runner ships a precomputed diff via this env
	// var so the receiving container does not need a working `.git`.
	const inputFile = process.env["BEDROCK_DIFF_INPUT_FILE"];
	if (inputFile !== undefined && inputFile !== "") {
		return readFileSync(inputFile, "utf8");
	}

	const baseRef = process.env["MUTATE_BASE_REF"];
	const diffTarget = baseRef === undefined || baseRef === "" ? "HEAD" : `${baseRef}...HEAD`;
	// The default 1 MiB maxBuffer kills git (status null) on diffs that
	// touch the multi-megabyte vendored openapi spec.
	const result = spawnSync("git", ["diff", "--unified=0", diffTarget], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
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

/**
 * Whether a package's own tests reach for the `lute` runtime, and so skip
 * themselves when it is absent.
 *
 * @param packageDirectory - Package to scan.
 * @returns `true` when any of its sources name the lute test helper.
 */
async function usesLuteAsync(packageDirectory: string): Promise<boolean> {
	const roots = [`${packageDirectory}/src/**/*.ts`, `${packageDirectory}/tests/**/*.ts`];
	for await (const file of glob(roots)) {
		if (readFileSync(file, "utf8").includes(LUTE_HELPER_SPECIFIER)) {
			return true;
		}
	}

	return false;
}

/**
 * Refuses to mutate a package whose tests need `lute` while the runtime is
 * unusable: those tests skip, and the mutants they would have killed report
 * as survived. A run covering only packages that never reach for lute is
 * left alone, as is a diff with nothing to mutate.
 *
 * @param packageDirectories - Packages this run is about to mutate.
 * @rejects When a package needs lute and no usable runtime is reachable.
 */
async function assertLuteAvailableAsync(packageDirectories: Iterable<string>): Promise<void> {
	const usage = await Promise.all(Array.from(packageDirectories, usesLuteAsync));
	if (!usage.includes(true)) {
		return;
	}

	const failure = luteRequirementFailure(detectLute());
	if (failure !== undefined) {
		throw new Error(failure);
	}
}

function runStrykerForEach(
	grouped: Map<
		string,
		Array<{ hunks: Array<{ endLine: number; startLine: number }>; path: string }>
	>,
	packagesWithSpecChanges: ReadonlySet<string>,
): boolean {
	const statuses = Array.from(grouped, ([packageDirectory, files]) => {
		const args = buildMutateArgs(files);
		const force = packagesWithSpecChanges.has(packageDirectory) ? ["--force"] : [];
		const note = force.length > 0 ? " (--force: specs changed)" : "";
		console.log(`\n→ Running Stryker in ${packageDirectory}${note}`);
		return spawnSync(
			"pnpm",
			["exec", "stryker", "run", "stryker.config.ts", ...force, ...args],
			{
				cwd: packageDirectory,
				stdio: "inherit",
			},
		).status;
	});
	return statuses.some((status) => status !== 0);
}

/**
 * The changed files worth mutating: mutable by path, and carrying something
 * to mutate once a types-only module is set aside.
 *
 * @param files - Every changed file the diff reported.
 * @returns The subset Stryker is asked to mutate.
 */
function mutableSourceFiles(
	files: Parameters<typeof filterMutableFiles>[0],
): ReturnType<typeof filterMutableFiles> {
	return filterMutableFiles(files).filter((file) => {
		return !isTypesOnlyModule(readFileSync(file.path, "utf8"));
	});
}

function reportReject(reason: { kind: string; path: string }): void {
	console.warn(`note: skipping ${reason.kind} file ${reason.path}`);
}

async function main(): Promise<void> {
	const remoteHost = process.env["BEDROCK_REMOTE_MUTATE_HOST"];
	if (remoteHost !== undefined && remoteHost !== "") {
		const result = spawnSync("bun", ["scripts/mutate-remote.ts"], { stdio: "inherit" });
		process.exit(result.status ?? 1);
	}

	const raw = readGitDiff();
	const parsed = parseDiff(raw);

	for (const reason of parsed.rejects) {
		reportReject(reason);
	}

	const mutable = mutableSourceFiles(parsed.files);
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

	await assertLuteAvailableAsync(grouped.keys());
	const packagesWithSpecChanges = findPackagesWithChangedSpecs(parsed.files, packageDirectories);
	const hasFailed = runStrykerForEach(grouped, packagesWithSpecChanges);
	if (hasFailed) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
