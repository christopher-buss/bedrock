// Rewrites every `@since unreleased` placeholder to the version the package is
// being released as. Run by the release pipeline after `pnpm version -r`, so
// resolved tags land in the same commit as the bump, and rerun in publish mode
// as a leak guard that fails on any rewrite.
//
// Known edge: a release whose pending intents all decline a bump leaves the
// versions unchanged, so a placeholder present then resolves to the version
// already published. Reaching it means a change adding public API recorded
// `--bump none`.

import {
	isResolvableSource,
	publishedVersion,
	resolveUnreleasedSinceTags,
} from "@bedrock-rbx/testing/since-tags";

import { readFileSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PACKAGE_MANIFESTS = "packages/*/package.json";
const RESOLVABLE_SOURCES = "{src,scripts}/**/*.ts";

async function resolvePackage(packageRoot: string, version: string): Promise<Array<string>> {
	const rewritten: Array<string> = [];
	const sources = glob(RESOLVABLE_SOURCES, { cwd: packageRoot });
	for await (const relativePath of sources) {
		if (!isResolvableSource(relativePath)) {
			continue;
		}

		const filePath = path.join(packageRoot, relativePath);
		const source = readFileSync(filePath, "utf8");
		const resolved = resolveUnreleasedSinceTags(source, version);
		if (resolved !== source) {
			writeFileSync(filePath, resolved);
			rewritten.push(filePath);
		}
	}

	return rewritten;
}

async function main(): Promise<void> {
	const rewritten: Array<string> = [];
	const manifests = glob(PACKAGE_MANIFESTS);
	for await (const manifestPath of manifests) {
		const version = publishedVersion(readFileSync(manifestPath, "utf8"));
		if (version === undefined) {
			continue;
		}

		const packageRoot = path.dirname(manifestPath);
		const resolved = await resolvePackage(packageRoot, version);
		for (const filePath of resolved) {
			console.log(`→ ${filePath} (@since ${version})`);
		}

		rewritten.push(...resolved);
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
