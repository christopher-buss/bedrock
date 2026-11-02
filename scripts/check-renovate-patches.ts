#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import process from "node:process";

/**
 * Fails when `.github/renovate.json` and `patchedDependencies` disagree.
 *
 * A patch keyed to `name@version` stops applying when that version changes,
 * and pnpm then refuses to write the lockfile. Inside the grouped patch PR
 * that one failure blocks every other update, so each version-pinned patched
 * package must be excluded from the `all-patch` group rules and listed in the
 * rule that gives it its own PR. Lists may use globs, so a family released
 * in lockstep (exact peer dependencies) stays in one PR with its unpatched
 * members.
 */

const PATCHED_RULE = "Patched dependencies";
const GROUP_SLUG = "all-patch";

interface Rule {
	description: string;
	groupSlug: string | undefined;
	names: Array<string>;
}

function isJsonObject(value: unknown): value is JSONObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(object: JSONObject, key: string): string | undefined {
	const value = object[key];
	return typeof value === "string" ? value : undefined;
}

function readRules(raw: string): Array<Rule> {
	const config = JSON.parse(raw);
	const rules = isJsonObject(config) ? config["packageRules"] : undefined;
	return (Array.isArray(rules) ? rules : []).filter(isJsonObject).map((rule) => {
		const names = rule["matchPackageNames"];
		return {
			description: readString(rule, "description") ?? "",
			groupSlug: readString(rule, "groupSlug"),
			names: (Array.isArray(names) ? names : []).filter((name) => typeof name === "string"),
		};
	});
}

const workspace: unknown = Bun.YAML.parse(readFileSync("pnpm-workspace.yaml", "utf8"));
const patches = isJsonObject(workspace) ? workspace["patchedDependencies"] : undefined;
const rules = readRules(readFileSync(".github/renovate.json", "utf8"));

// A key without a version applies to every version, so bumps cannot break it.
const patched = Object.keys(isJsonObject(patches) ? patches : {})
	.filter((key) => key.lastIndexOf("@") > 0)
	.map((key) => key.slice(0, key.lastIndexOf("@")))
	.toSorted();

const errors: Array<string> = [];

function compare(where: string, patterns: Array<string>): void {
	const globs = patterns.map((pattern) => ({ glob: new Bun.Glob(pattern), pattern }));
	const missing = patched.filter((name) => globs.every(({ glob }) => !glob.match(name)));
	const stale = globs.filter(({ glob }) => patched.every((name) => !glob.match(name)));
	errors.push(
		...missing.map((name) => `${where}: missing ${name}`),
		...stale.map(({ pattern }) => `${where}: ${pattern} matches no version-pinned patch`),
	);
}

const patchedRule = rules.find((rule) => rule.description === PATCHED_RULE);
if (patchedRule === undefined) {
	errors.push(`no package rule with description "${PATCHED_RULE}"`);
} else {
	compare(`"${PATCHED_RULE}" rule`, patchedRule.names);
}

const groupRules = rules.filter((rule) => rule.groupSlug === GROUP_SLUG);
if (groupRules.length === 0) {
	errors.push(`no package rule with groupSlug "${GROUP_SLUG}"`);
}

for (const rule of groupRules) {
	// Renovate matches every package a negation-only list does not exclude.
	if (rule.names.some((name) => !name.startsWith("!"))) {
		errors.push(`"${rule.description}" rule: matchPackageNames must hold only "!" patterns`);
	}

	compare(
		`"${rule.description}" rule exclusions`,
		rule.names.filter((name) => name.startsWith("!")).map((name) => name.slice(1)),
	);
}

if (errors.length > 0) {
	console.error("Renovate rules do not match patchedDependencies in pnpm-workspace.yaml:");
	for (const error of errors) {
		console.error(`  ${error}`);
	}

	process.exit(1);
}
