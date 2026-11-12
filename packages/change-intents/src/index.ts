import { parseYAML } from "confbox";
import npa from "npm-package-arg";
import { minVersion, subset } from "semver";

/** Dependency sections relevant to release policy. */
export interface Manifest {
	/** Workspace package identity. */
	name: string;
	/** Preserve metadata for detection of non-dependency edits. */
	[key: string]: JSONValue | undefined;
	/** Published runtime dependencies. */
	dependencies?: Record<string, string>;
	/** Development dependencies, some of which may be bundled. */
	devDependencies?: Record<string, string>;
	/** Optional runtime dependencies. */
	optionalDependencies?: Record<string, string>;
	/** Consumer compatibility requirements. */
	peerDependencies?: Record<string, string>;
	/** Absence excludes an unversioned package. */
	version?: string;
}
/** Immutable repository dependency data. */
export interface Snapshot {
	/** Workspace-directory to manifest mapping; excludes the root. */
	packages: Record<string, Manifest>;
	/** Native pnpm catalog and release settings. */
	workspace: {
		catalog?: Record<string, string>;
		catalogs?: Record<string, Record<string, string>>;
		versioning?: { ignore?: Array<string> };
	};
}
/** Inputs supplied by a trusted reader. */
export interface IntentInput {
	/** Base tree. */
	base: Snapshot;
	/** Effective merged tree. */
	head: Snapshot;
	/** Frontmatter from human intents added or modified by this PR. */
	humanIntents: Array<Record<string, string>>;
	/** Pull request number. */
	number: number;
	/** Paths changed between the base and merged trees. */
	paths: Array<string>;
}
/** Proposed intent and decisions requiring a human. */
export interface IntentPlan {
	/**
	 * Directly changed versioned consumers, including human-covered packages.
	 */
	affected: Array<string>;
	/** Desired generated-file bytes; undefined means remove or leave absent. */
	content: string | undefined;
	/** Unresolved decisions; generated coverage cannot resolve them. */
	review: Array<string>;
}

const roles = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;
const collator = new Intl.Collator("en");
type Role = (typeof roles)[number];
interface Delta {
	after: string | undefined;
	before: string | undefined;
	dependency: string;
	role: Role;
}
interface Decision {
	name: string;
	bump: string;
	changed: boolean;
	human: boolean;
	review: Array<string>;
	summaries: Array<string>;
}

/**
 * Derive native pnpm release participants without a special-case private package.
 * @param snapshot - Workspace configuration and manifests.
 * @returns Sorted names of versioned workspace packages.
 */
export function versionedNames(snapshot: Snapshot): Array<string> {
	return Object.entries(snapshot.packages)
		.filter(([directory, manifest]) => {
			return (
				directory !== "." &&
				manifest.version !== undefined &&
				snapshot.workspace.versioning?.ignore?.includes(manifest.name) !== true
			);
		})
		.map(([, manifest]) => manifest.name)
		.toSorted();
}

/**
 * Plan directly affected consumers without inferring release intent from a PR title.
 * @param input - Base and merged dependency snapshots and PR-owned human intents.
 * @returns Canonical intent content, selected consumers and unresolved review reasons.
 */
export function planIntents(input: IntentInput): IntentPlan {
	const names = versionedNames(input.head);
	const versioned = Object.entries(input.head.packages).filter(([, manifest]) => {
		return names.includes(manifest.name);
	});
	const decisions = versioned
		.map((entry) => classify(input, entry))
		.filter((decision) => decision.changed);
	const automated = decisions.filter((decision) => !decision.human);
	const entries = automated
		.map((decision) => `${JSON.stringify(decision.name)}: ${decision.bump}`)
		.toSorted();
	const summaries = new Set(automated.flatMap((decision) => decision.summaries));
	return {
		affected: decisions.map((decision) => decision.name).toSorted(),
		content:
			entries.length === 0
				? undefined
				: `---\n${entries.join("\n")}\n---\n\nUpdate dependencies:\n${[...summaries].toSorted().join("\n")}\n`,
		review: automated.flatMap((decision) => decision.review),
	};
}

/**
 * Read and validate Changesets-format frontmatter, including native pnpm declines.
 * @param content - Complete Markdown intent.
 * @returns Package names mapped to explicit bump choices.
 * @throws When frontmatter is absent, malformed or contains an invalid bump.
 */
export function parseIntent(content: string): Record<string, string> {
	const lines = content.replaceAll("\r\n", "\n").split("\n");
	const end = lines.indexOf("---", 1);
	if (lines[0] !== "---" || end < 1) {
		throw new Error("Missing intent frontmatter");
	}

	const frontmatter = lines.slice(1, end).join("\n");
	const parsed = frontmatter.trim() === "" ? {} : parseYAML<JSONValue>(frontmatter);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Invalid intent frontmatter");
	}

	const result: Record<string, string> = {};
	for (const [name, bump] of Object.entries(parsed)) {
		if (bump !== "none" && bump !== "patch" && bump !== "minor") {
			throw new Error(`Invalid intent bump for ${name}`);
		}

		result[name] = bump;
	}

	return result;
}

function effective(
	snapshot: Snapshot,
	entry: { dependency: string; value: string | undefined },
): string | undefined {
	if (entry.value?.startsWith("catalog:") !== true) {
		return entry.value;
	}

	const catalog = entry.value.slice("catalog:".length);
	return (catalog === "" ? snapshot.workspace.catalog : snapshot.workspace.catalogs?.[catalog])?.[
		entry.dependency
	];
}

function deltas(input: IntentInput, directory: string): Array<Delta> {
	const result: Array<Delta> = [];
	for (const role of roles) {
		const before = input.base.packages[directory]?.[role] ?? {};
		const after = input.head.packages[directory]?.[role] ?? {};
		const names = new Set([...Object.keys(before), ...Object.keys(after)]);
		for (const dependency of names) {
			const previous = effective(input.base, { dependency, value: before[dependency] });
			const current = effective(input.head, { dependency, value: after[dependency] });
			if (previous !== current) {
				result.push({ after: current, before: previous, dependency, role });
			}
		}
	}

	return result;
}

function resolved(
	dependency: string,
	value: string | undefined,
): undefined | { name: string; range: string } {
	if (value === undefined) {
		return undefined;
	}

	try {
		const parsed = npa.resolve(dependency, value);
		const target = parsed.type === "alias" ? parsed.subSpec : parsed;
		if (target.type !== "version" && target.type !== "range") {
			return undefined;
		}

		return { name: String(target.name), range: String(target.fetchSpec) };
	} catch {
		return undefined;
	}
}

function compatible(delta: Delta): undefined | { name: string; range: string } {
	const before = resolved(delta.dependency, delta.before);
	const after = resolved(delta.dependency, delta.after);
	if (before === undefined || after === undefined) {
		return undefined;
	}

	if (before.name !== after.name) {
		return undefined;
	}

	const minimum = minVersion(before.range);
	const current = minVersion(after.range);
	const safe = minimum !== null && current !== null && subset(after.range, `^${minimum.version}`);
	return safe ? after : undefined;
}

function applyDelta(decision: Decision, delta: Delta): void {
	decision.changed = true;
	const update = compatible(delta);
	if (update === undefined || delta.role === "peerDependencies") {
		decision.review.push(`${decision.name}: review ${delta.dependency}`);
		return;
	}

	// A bundler builds the shipped output, so its update ships like a runtime
	// one.
	const ships = delta.role !== "devDependencies" || update.name === "tsdown";
	if (ships) {
		decision.bump = "patch";
	} else if (update.name !== "vitest") {
		decision.review.push(`${decision.name}: review ${delta.dependency}`);
	}

	decision.summaries.push(`- ${delta.dependency}: ${delta.before} → ${delta.after}`);
}

function metadata(manifest: Manifest | undefined): string {
	return JSON.stringify(
		Object.entries(manifest ?? {})
			.filter(([key]) => roles.every((role) => role !== key))
			.toSorted(([left], [right]) => collator.compare(left, right)),
	);
}

function classify(input: IntentInput, entry: [string, Manifest]): Decision {
	const [directory, manifest] = entry;
	const paths = input.paths.filter((path) => path.startsWith(`${directory}/`));
	const decision: Decision = {
		name: manifest.name,
		bump: "none",
		changed: paths.length > 0,
		human: input.humanIntents.some((intent) => Object.hasOwn(intent, manifest.name)),
		review: [],
		summaries: [],
	};
	if (paths.some((path) => path !== `${directory}/package.json`)) {
		decision.review.push(`${manifest.name}: review source changes`);
	}

	if (metadata(input.base.packages[directory]) !== metadata(manifest)) {
		decision.review.push(`${manifest.name}: review manifest changes`);
	}

	const updates = deltas(input, directory);
	if (decision.changed && updates.length === 0 && decision.review.length === 0) {
		decision.review.push(`${manifest.name}: review unexplained manifest changes`);
	}

	for (const delta of updates) {
		applyDelta(decision, delta);
	}

	return decision;
}
