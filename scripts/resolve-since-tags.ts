// Rewrites every `@since unreleased` placeholder to the version the package is
// being released as. Run by the release pipeline after `pnpm version -r`, so
// resolved tags land in the same commit as the bump, and rerun in publish mode
// as a leak guard.
//
// A placeholder in a package whose version did not change has no release to
// resolve to. Stamping it with the version already published would record a
// false introducing version and leave nothing for the guard to catch, so it is
// reported and fails the run instead.

import {
	planSinceTagRewrites,
	publishedVersion,
	type SourceModule,
} from "@bedrock-rbx/testing/since-tags";

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

interface PackageOutcome {
	readonly rewritten: ReadonlyArray<string>;
	readonly unresolvable: ReadonlyArray<string>;
}

const PACKAGE_MANIFESTS = "packages/*/package.json";
const RESOLVABLE_SOURCES = "{src,scripts}/**/*.ts";

async function readModules(packageRoot: string): Promise<Array<SourceModule>> {
	const modules: Array<SourceModule> = [];
	const sources = glob(RESOLVABLE_SOURCES, { cwd: packageRoot });
	for await (const relativePath of sources) {
		modules.push({
			path: relativePath,
			text: readFileSync(path.join(packageRoot, relativePath), "utf8"),
		});
	}

	return modules;
}

function isVersionBumped(manifestPath: string): boolean {
	const { status } = spawnSync("git", ["diff", "--quiet", "HEAD", "--", manifestPath]);
	if (status === 0) {
		return false;
	}

	if (status === 1) {
		return true;
	}

	throw new Error(`git diff failed for ${manifestPath} with status ${String(status)}`);
}

const NOTHING_TO_DO: PackageOutcome = { rewritten: [], unresolvable: [] };

async function resolvePackage(manifestPath: string): Promise<PackageOutcome> {
	const version = publishedVersion(readFileSync(manifestPath, "utf8"));
	if (version === undefined) {
		return NOTHING_TO_DO;
	}

	const packageRoot = path.dirname(manifestPath);
	const plan = planSinceTagRewrites(await readModules(packageRoot), version);
	if (plan.length === 0) {
		return NOTHING_TO_DO;
	}

	const paths = plan.map((module) => path.join(packageRoot, module.path));
	if (!isVersionBumped(manifestPath)) {
		return { rewritten: [], unresolvable: paths };
	}

	for (const module of plan) {
		writeFileSync(path.join(packageRoot, module.path), module.text);
		console.log(`→ ${path.join(packageRoot, module.path)} (@since ${version})`);
	}

	return { rewritten: paths, unresolvable: [] };
}

async function main(): Promise<void> {
	const rewritten: Array<string> = [];
	const unresolvable: Array<string> = [];
	const manifests = glob(PACKAGE_MANIFESTS);
	for await (const manifestPath of manifests) {
		const outcome = await resolvePackage(manifestPath);
		rewritten.push(...outcome.rewritten);
		unresolvable.push(...outcome.unresolvable);
	}

	if (unresolvable.length > 0) {
		const listed = unresolvable.map((filePath) => `  ${filePath}`).join("\n");
		console.error(`@since placeholders in a package with no version bump:\n${listed}`);
		process.exit(1);
	}

	console.log(
		rewritten.length === 0
			? "No unresolved @since placeholders."
			: `Resolved @since placeholders in ${String(rewritten.length)} file(s).`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
