import { describe, it } from "vitest";

import { parseIntent, planIntents, versionedNames } from "./index.ts";
import type { IntentInput, Manifest } from "./index.ts";

function dependencyUpdate(before: Manifest, after: Manifest): IntentInput {
	return {
		base: { packages: { "packages/core": before }, workspace: {} },
		head: { packages: { "packages/core": after }, workspace: {} },
		humanIntents: [],
		number: 7,
		paths: ["packages/core/package.json"],
	};
}

describe("change intents", () => {
	it("should write sorted multi-package intents while excluding ignored and unversioned consumers", ({
		expect,
	}) => {
		expect.hasAssertions();

		const packages = {
			"examples/example": { name: "example", dependencies: { lib: "catalog:" } },
			"packages/a": { name: "a", dependencies: { lib: "catalog:" }, version: "0.1.0" },
			"packages/ignored": {
				name: "ignored",
				dependencies: { lib: "catalog:" },
				version: "0.1.0",
			},
			"packages/z": { name: "z", dependencies: { lib: "catalog:" }, version: "0.1.0" },
		};
		const input = {
			base: { packages, workspace: { catalog: { lib: "1.0.0" } } },
			head: {
				packages,
				workspace: { catalog: { lib: "1.0.1" }, versioning: { ignore: ["ignored"] } },
			},
			humanIntents: [],
			number: 9,
			paths: ["pnpm-workspace.yaml"],
		};

		expect(planIntents(input)).toStrictEqual({
			affected: ["a", "z"],
			content:
				'---\n"a": patch\n"z": patch\n---\n\nUpdate dependencies:\n- lib: 1.0.0 → 1.0.1\n',
			review: [],
		});
	});

	it("should validate both frontmatter delimiters independently and allow an empty human intent", ({
		expect,
	}) => {
		expect.hasAssertions();
		expect(() => parseIntent("not a delimiter\ncore: none\n---")).toThrow(
			"Missing intent frontmatter",
		);
		expect(() => parseIntent("---\ncore: none")).toThrow("Missing intent frontmatter");
		expect(() => parseIntent("---\ntrue\n---")).toThrow("Invalid intent frontmatter");
		expect(parseIntent("---\n---")).toStrictEqual({});
		expect(parseIntent("---\n  \n---")).toStrictEqual({});
	});

	it("should require review when selected manifest edits have no explaining dependency delta", ({
		expect,
	}) => {
		expect.hasAssertions();

		const input = dependencyUpdate(
			{ name: "core", version: "0.1.0" },
			{ name: "core", version: "0.1.0" },
		);

		expect(planIntents(input).review).toStrictEqual([
			"core: review unexplained manifest changes",
		]);
	});

	it("should leave unchanged dependencies and packages without versions outside the release plan", ({
		expect,
	}) => {
		expect.hasAssertions();

		const input = dependencyUpdate(
			{ name: "core", dependencies: { lib: "1.0.0" }, version: "0.1.0" },
			{ name: "core", dependencies: { lib: "1.0.0" }, version: "0.1.0" },
		);
		input.paths = ["pnpm-lock.yaml"];

		expect(planIntents(input).affected).toStrictEqual([]);
	});

	it("should review a newly introduced versioned package", ({ expect }) => {
		expect.hasAssertions();
		expect(
			planIntents({
				base: { packages: {}, workspace: {} },
				head: {
					packages: {
						"packages/new": {
							name: "new",
							dependencies: { lib: "1.0.0" },
							version: "0.1.0",
						},
					},
					workspace: {},
				},
				humanIntents: [],
				number: 8,
				paths: ["packages/new/package.json"],
			}).review,
		).toStrictEqual(["new: review manifest changes", "new: review lib"]);
	});

	it.for<[string, string]>([
		["2.2.8", "3.0.0"],
		["0.2.1", "0.3.0"],
		["2.2.8", "2.2.7"],
		["2.2.8", "*"],
		["2.2.8", "workspace:*"],
		["2.2.8", "git+https://example.com/repo"],
		["npm:one@2.2.8", "npm:two@2.2.9"],
		["not a valid package", "2.2.9"],
		[">=3 <2", "3.0.0"],
		["2.2.8", ">=3 <2"],
	])(
		"should request review for uncertain runtime change from %s to %s",
		([before, after], { expect }) => {
			expect.hasAssertions();

			const result = planIntents(
				dependencyUpdate(
					{ name: "core", dependencies: { lib: before }, version: "0.1.0" },
					{ name: "core", dependencies: { lib: after }, version: "0.1.0" },
				),
			);

			expect(result.review).toStrictEqual(["core: review lib"]);
		},
	);

	it("should require review for added, removed and peer dependencies", ({ expect }) => {
		expect.hasAssertions();
		expect(
			planIntents(
				dependencyUpdate(
					{
						name: "core",
						dependencies: { removed: "1.0.0" },
						peerDependencies: { peer: "1.0.0" },
						version: "0.1.0",
					},
					{
						name: "core",
						dependencies: { added: "1.0.0" },
						peerDependencies: { peer: "1.0.1" },
						version: "0.1.0",
					},
				),
			).review,
		).toStrictEqual(["core: review removed", "core: review added", "core: review peer"]);
	});

	it("should preserve per-package human intent authority without generating duplicate coverage", ({
		expect,
	}) => {
		expect.hasAssertions();

		const input = dependencyUpdate(
			{ name: "core", version: "0.1.0" },
			{ name: "core", scripts: { build: "changed" }, version: "0.1.0" },
		);
		input.humanIntents = [{ core: "none" }];

		expect(planIntents(input)).toStrictEqual({
			affected: ["core"],
			content: undefined,
			review: [],
		});
	});

	it("should leave unrelated and lockfile-only changes without generated intents", ({
		expect,
	}) => {
		expect.hasAssertions();

		const input = dependencyUpdate(
			{ name: "core", version: "0.1.0" },
			{ name: "core", version: "0.1.0" },
		);
		input.paths = ["pnpm-lock.yaml"];

		expect(planIntents(input)).toStrictEqual({ affected: [], content: undefined, review: [] });
	});

	it("should resolve default catalogs and keep unknown catalogs for review", ({ expect }) => {
		expect.hasAssertions();

		const input = dependencyUpdate(
			{ name: "core", dependencies: { lib: "catalog:" }, version: "0.1.0" },
			{ name: "core", dependencies: { lib: "catalog:" }, version: "0.1.0" },
		);
		input.base.workspace.catalog = { lib: "1.0.0" };
		input.head.workspace.catalog = { lib: "1.0.1" };

		expect(planIntents(input).content).toContain('"core": patch');

		input.head.packages["packages/core"] = {
			name: "core",
			dependencies: { lib: "catalog:missing" },
			version: "0.1.0",
		};

		expect(planIntents(input).review).toStrictEqual(["core: review lib"]);
	});

	it.for<string>([
		"no frontmatter",
		"---\n[]\n---",
		"---\nnull\n---",
		"---\ntext\n---",
		"---\ncore: major\n---",
	])("should reject malformed or unsupported human intent %s", (content, { expect }) => {
		expect.hasAssertions();
		expect(() => parseIntent(content)).toThrow(/intent/iu);
	});

	it("should parse quoted and commented human bumps with windows newlines", ({ expect }) => {
		expect.hasAssertions();
		expect(
			parseIntent("---\r\n'core': patch # compatible\r\nother: minor\r\n---\r\nSummary"),
		).toStrictEqual({ core: "patch", other: "minor" });
	});

	it("should derive versioned scope and parse explicit human declines", ({ expect }) => {
		expect.hasAssertions();
		expect(
			versionedNames({
				packages: {
					".": { name: "root", version: "0.0.0" },
					"examples/demo": { name: "example", private: true },
					"packages/actions": { name: "actions", private: true, version: "0.1.0" },
					"packages/ignored": { name: "ignored", version: "0.0.0" },
				},
				workspace: { versioning: { ignore: ["ignored"] } },
			}),
		).toStrictEqual(["actions"]);
		expect(parseIntent('---\n"actions": none\n---\n\nNo action release.')).toStrictEqual({
			actions: "none",
		});
		expect(() => parseIntent('---\n"actions": invalid\n---\n')).toThrow("Invalid intent bump");
	});

	it("should review source-affecting manifest fields and unknown build dependencies", ({
		expect,
	}) => {
		expect.hasAssertions();

		const base = {
			packages: {
				"packages/core": {
					name: "core",
					devDependencies: { typescript: "6.0.1" },
					scripts: { build: "old" },
					version: "0.1.0",
				},
			},
			workspace: {},
		};
		const head = {
			packages: {
				"packages/core": {
					name: "core",
					devDependencies: { typescript: "6.0.2" },
					scripts: { build: "new" },
					version: "0.1.0",
				},
			},
			workspace: {},
		};

		expect(
			planIntents({
				base,
				head,
				humanIntents: [],
				number: 4,
				paths: ["packages/core/package.json"],
			}).review,
		).toStrictEqual(["core: review manifest changes", "core: review typescript"]);
	});

	it("should resolve aliases before applying the development-only allowlist", ({ expect }) => {
		expect.hasAssertions();

		const base = {
			packages: {
				"packages/core": {
					name: "core",
					devDependencies: { runner: "npm:vitest@5.0.4" },
					version: "0.1.0",
				},
			},
			workspace: {},
		};
		const head = {
			packages: {
				"packages/core": {
					name: "core",
					devDependencies: { runner: "npm:vitest@5.0.5" },
					version: "0.1.0",
				},
			},
			workspace: {},
		};
		const result = planIntents({
			base,
			head,
			humanIntents: [],
			number: 5,
			paths: ["packages/core/package.json"],
		});

		expect(result.review).toStrictEqual([]);
		expect(result.content).toContain('"core": none');
	});

	it("should accept compatible runtime ranges without approving a new compatibility boundary", ({
		expect,
	}) => {
		expect.hasAssertions();

		const base = {
			packages: {
				"packages/core": {
					name: "core",
					dependencies: { lib: "^2.2.8" },
					version: "0.1.0",
				},
			},
			workspace: {},
		};
		const head = {
			packages: {
				"packages/core": {
					name: "core",
					dependencies: { lib: "^2.2.9" },
					version: "0.1.0",
				},
			},
			workspace: {},
		};

		expect(
			planIntents({
				base,
				head,
				humanIntents: [],
				number: 6,
				paths: ["packages/core/package.json"],
			}).review,
		).toStrictEqual([]);
	});

	it("should expand changed catalogs and decline only known development tooling", ({
		expect,
	}) => {
		expect.hasAssertions();

		const packages = {
			"packages/core": {
				name: "core",
				devDependencies: { vitest: "catalog:test" },
				version: "0.1.0",
			},
		};
		const plan = planIntents({
			base: { packages, workspace: { catalogs: { test: { vitest: "5.0.4" } } } },
			head: { packages, workspace: { catalogs: { test: { vitest: "5.0.5" } } } },
			humanIntents: [],
			number: 2,
			paths: ["pnpm-workspace.yaml"],
		});

		expect(plan.affected).toStrictEqual(["core"]);
		expect(plan.review).toStrictEqual([]);
		expect(plan.content).toContain('"core": none');
	});

	it("should require review for source edits even when a dependency is safe", ({ expect }) => {
		expect.hasAssertions();

		const packages = { "packages/core": { name: "core", version: "0.1.0" } };

		expect(
			planIntents({
				base: { packages, workspace: {} },
				head: { packages, workspace: {} },
				humanIntents: [],
				number: 3,
				paths: ["packages/core/src/index.ts"],
			}).review,
		).toStrictEqual(["core: review source changes"]);
	});

	it("should record compatible runtime updates and explicit tooling declines", ({ expect }) => {
		expect.hasAssertions();

		const base = {
			packages: {
				"packages/core": {
					name: "core",
					dependencies: { arktype: "2.2.8" },
					devDependencies: { vitest: "5.0.4" },
					version: "0.1.0",
				},
			},
			workspace: {},
		};
		const head = {
			packages: {
				"packages/core": {
					name: "core",
					dependencies: { arktype: "2.2.9" },
					devDependencies: { vitest: "5.0.5" },
					version: "0.1.0",
				},
			},
			workspace: {},
		};

		expect(
			planIntents({
				base,
				head,
				humanIntents: [],
				number: 1,
				paths: ["packages/core/package.json"],
			}).content,
		).toBe(
			'---\n"core": patch\n---\n\nUpdate dependencies:\n- arktype: 2.2.8 → 2.2.9\n- vitest: 5.0.4 → 5.0.5\n',
		);
	});
});
