import { describe, expect, it } from "vitest";

import {
	buildMutateArgs,
	filterMutableFiles,
	groupByPackage,
	isTypesOnlyModule,
	parseDiff,
} from "./stryker-diff.ts";

describe(parseDiff, () => {
	it("should return no files for an empty diff", () => {
		expect.assertions(1);

		const result = parseDiff("");

		expect(result).toStrictEqual({ files: [], kind: "changes" });
	});

	it("should reject a binary file change with its path", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/assets/logo.png b/assets/logo.png",
			"index abc1234..def5678 100644",
			"Binary files a/assets/logo.png and b/assets/logo.png differ",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			kind: "reject",
			reasons: [{ kind: "binary", path: "assets/logo.png" }],
		});
	});

	it("should record a newly added file with a hunk covering every added line", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/new.ts b/src/new.ts",
			"new file mode 100644",
			"index 0000000..abc1234",
			"--- /dev/null",
			"+++ b/src/new.ts",
			"@@ -0,0 +1,3 @@",
			"+a",
			"+b",
			"+c",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			files: [{ hunks: [{ endLine: 3, startLine: 1 }], path: "src/new.ts" }],
			kind: "changes",
		});
	});

	it("should drop a deleted file entirely so mutate-changed never opens a missing path", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/old.ts b/src/old.ts",
			"deleted file mode 100644",
			"index abc1234..0000000",
			"--- a/src/old.ts",
			"+++ /dev/null",
			"@@ -1,3 +0,0 @@",
			"-a",
			"-b",
			"-c",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({ files: [], kind: "changes" });
	});

	it("should drop only the deleted files and keep the surviving modifications", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/gone.ts b/src/gone.ts",
			"deleted file mode 100644",
			"index abc1234..0000000",
			"--- a/src/gone.ts",
			"+++ /dev/null",
			"@@ -1,2 +0,0 @@",
			"-a",
			"-b",
			"diff --git a/src/alive.ts b/src/alive.ts",
			"index ffff..1111 100644",
			"--- a/src/alive.ts",
			"+++ b/src/alive.ts",
			"@@ -3 +3 @@",
			"-old",
			"+new",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			files: [{ hunks: [{ endLine: 3, startLine: 3 }], path: "src/alive.ts" }],
			kind: "changes",
		});
	});

	it("should drop a pure rename since it has no hunks to mutate at the new path", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/old.ts b/src/new.ts",
			"similarity index 100%",
			"rename from src/old.ts",
			"rename to src/new.ts",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({ files: [], kind: "changes" });
	});

	it("should collapse a rename with modifications to a change entry at the new path", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/old.ts b/src/new.ts",
			"similarity index 90%",
			"rename from src/old.ts",
			"rename to src/new.ts",
			"index abc1234..def5678 100644",
			"--- a/src/old.ts",
			"+++ b/src/new.ts",
			"@@ -3 +3 @@",
			"-old",
			"+new",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			files: [{ hunks: [{ endLine: 3, startLine: 3 }], path: "src/new.ts" }],
			kind: "changes",
		});
	});

	it("should extract the hunk range for a single modified file", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/foo.ts b/src/foo.ts",
			"index abc1234..def5678 100644",
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -5,2 +5,3 @@",
			"-old",
			"-old",
			"+new",
			"+new",
			"+new",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			files: [{ hunks: [{ endLine: 7, startLine: 5 }], path: "src/foo.ts" }],
			kind: "changes",
		});
	});

	it("should collect every hunk range when a file has multiple hunks", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/foo.ts b/src/foo.ts",
			"index abc1234..def5678 100644",
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -1 +1 @@",
			"-a",
			"+b",
			"@@ -10,2 +10,3 @@",
			"-x",
			"-y",
			"+p",
			"+q",
			"+r",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			files: [
				{
					hunks: [
						{ endLine: 1, startLine: 1 },
						{ endLine: 12, startLine: 10 },
					],
					path: "src/foo.ts",
				},
			],
			kind: "changes",
		});
	});

	it("should emit one entry per modified file when the diff spans several", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/a.ts b/src/a.ts",
			"index abc1..def2 100644",
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
			"@@ -3 +3 @@",
			"-a",
			"+b",
			"diff --git a/src/b.ts b/src/b.ts",
			"index ffff..1111 100644",
			"--- a/src/b.ts",
			"+++ b/src/b.ts",
			"@@ -7,2 +7,2 @@",
			"-x",
			"-y",
			"+p",
			"+q",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			files: [
				{ hunks: [{ endLine: 3, startLine: 3 }], path: "src/a.ts" },
				{ hunks: [{ endLine: 8, startLine: 7 }], path: "src/b.ts" },
			],
			kind: "changes",
		});
	});

	it("should skip pure-deletion hunks that have no new-side lines to mutate", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/foo.ts b/src/foo.ts",
			"index abc1234..def5678 100644",
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -10,3 +9,0 @@",
			"-removed",
			"-lines",
			"-only",
			"@@ -20,1 +18,1 @@",
			"-old",
			"+new",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			files: [{ hunks: [{ endLine: 18, startLine: 18 }], path: "src/foo.ts" }],
			kind: "changes",
		});
	});
});

describe(buildMutateArgs, () => {
	it("should return no args for an empty change set", () => {
		expect.assertions(1);

		expect(buildMutateArgs([])).toStrictEqual([]);
	});

	it("should emit one --mutate flag with comma-joined path:range patterns", () => {
		expect.assertions(1);

		const args = buildMutateArgs([
			{
				hunks: [
					{ endLine: 5, startLine: 1 },
					{ endLine: 20, startLine: 10 },
				],
				path: "src/a.ts",
			},
			{ hunks: [{ endLine: 3, startLine: 3 }], path: "src/b.ts" },
		]);

		expect(args).toStrictEqual(["--mutate", "src/a.ts:1-5,src/a.ts:10-20,src/b.ts:3-3"]);
	});
});

describe(groupByPackage, () => {
	it("should return an empty map when no files are given", () => {
		expect.assertions(1);

		expect(groupByPackage([], ["packages/open-cloud"])).toStrictEqual(new Map());
	});

	it("should bucket files by package and strip the package prefix", () => {
		expect.assertions(1);

		const files = [
			{ hunks: [{ endLine: 5, startLine: 1 }], path: "packages/open-cloud/src/a.ts" },
			{ hunks: [{ endLine: 3, startLine: 3 }], path: "packages/bedrock/src/b.ts" },
			{ hunks: [{ endLine: 2, startLine: 1 }], path: "packages/open-cloud/src/c.ts" },
		];

		const grouped = groupByPackage(files, ["packages/open-cloud", "packages/bedrock"]);

		expect(grouped).toStrictEqual(
			new Map([
				["packages/bedrock", [{ hunks: [{ endLine: 3, startLine: 3 }], path: "src/b.ts" }]],
				[
					"packages/open-cloud",
					[
						{ hunks: [{ endLine: 5, startLine: 1 }], path: "src/a.ts" },
						{ hunks: [{ endLine: 2, startLine: 1 }], path: "src/c.ts" },
					],
				],
			]),
		);
	});

	it("should drop files that fall outside every known package", () => {
		expect.assertions(1);

		const files = [
			{ hunks: [{ endLine: 5, startLine: 1 }], path: "scripts/foo.ts" },
			{ hunks: [{ endLine: 3, startLine: 3 }], path: "packages/bedrock/src/b.ts" },
		];

		const grouped = groupByPackage(files, ["packages/bedrock"]);

		expect(grouped).toStrictEqual(
			new Map([
				["packages/bedrock", [{ hunks: [{ endLine: 3, startLine: 3 }], path: "src/b.ts" }]],
			]),
		);
	});
});

describe(filterMutableFiles, () => {
	it("should drop spec, test, declaration, and non-TS files", () => {
		expect.assertions(1);

		const files = [
			{ hunks: [{ endLine: 1, startLine: 1 }], path: "src/a.ts" },
			{ hunks: [{ endLine: 2, startLine: 2 }], path: "src/a.spec.ts" },
			{ hunks: [{ endLine: 3, startLine: 3 }], path: "src/a.test.ts" },
			{ hunks: [{ endLine: 4, startLine: 4 }], path: "src/types.d.ts" },
			{ hunks: [{ endLine: 5, startLine: 5 }], path: "src/b.ts" },
			{ hunks: [{ endLine: 6, startLine: 6 }], path: "src/c.spec-d.ts" },
			{ hunks: [{ endLine: 7, startLine: 7 }], path: "CLAUDE.md" },
			{ hunks: [{ endLine: 8, startLine: 8 }], path: "src/component.tsx" },
		];

		expect(filterMutableFiles(files)).toStrictEqual([
			{ hunks: [{ endLine: 1, startLine: 1 }], path: "src/a.ts" },
			{ hunks: [{ endLine: 5, startLine: 5 }], path: "src/b.ts" },
			{ hunks: [{ endLine: 8, startLine: 8 }], path: "src/component.tsx" },
		]);
	});

	it("should drop files outside a src/ directory so Stryker's --mutate list cannot overreach", () => {
		expect.assertions(1);

		const files = [
			{ hunks: [{ endLine: 1, startLine: 1 }], path: "packages/open-cloud/src/index.ts" },
			{ hunks: [{ endLine: 2, startLine: 2 }], path: "packages/open-cloud/vite.config.ts" },
			{
				hunks: [{ endLine: 3, startLine: 3 }],
				path: "packages/open-cloud/tests/helpers/index.ts",
			},
			{ hunks: [{ endLine: 4, startLine: 4 }], path: "scripts/mutate-changed.ts" },
		];

		expect(filterMutableFiles(files)).toStrictEqual([
			{ hunks: [{ endLine: 1, startLine: 1 }], path: "packages/open-cloud/src/index.ts" },
		]);
	});
});

describe(isTypesOnlyModule, () => {
	it("should treat an empty source as types-only", () => {
		expect.assertions(1);

		expect(isTypesOnlyModule("")).toBeTrue();
	});

	it("should treat a comments-only source as types-only", () => {
		expect.assertions(1);

		const source = `
			// Just a header comment.
			/**
			 * And a block comment.
			 */
		`;

		expect(isTypesOnlyModule(source)).toBeTrue();
	});

	it.for<[label: string, source: string]>([
		["interface declaration", "export interface A { a: number; }"],
		["type alias", "export type B = { b: string };"],
		["type-only default import", 'import type X from "./other";\nexport type C = X;'],
		["type-only named import", 'import type { Y } from "./other";\nexport type D = Y;'],
		["type-only export specifier", "interface E { e: boolean; }\nexport type { E };"],
		[
			"mixed type-only imports and declarations",
			[
				'import type { Z } from "./z";',
				"export interface F { f: Z; }",
				"export type G = F;",
			].join("\n"),
		],
	])("should treat %s as types-only", ([, source]) => {
		expect.assertions(1);

		expect(isTypesOnlyModule(source)).toBeTrue();
	});

	it.for<[label: string, source: string]>([
		["value re-export from a module", 'export { run } from "./lib";'],
		[
			"mixed value and type re-exports from modules",
			[
				'export { ApiError } from "./errors/api-error.ts";',
				'export { OpenCloudError } from "./errors/base.ts";',
				'export type { Result } from "./types.ts";',
			].join("\n"),
		],
		["renamed value re-export from a module", 'export { run as go } from "./lib";'],
	])("should treat %s as types-only because it has no local runtime logic", ([, source]) => {
		expect.assertions(1);

		expect(isTypesOnlyModule(source)).toBeTrue();
	});

	it.for<[label: string, source: string]>([
		["function declaration", "export function h(): void {}"],
		["const binding", "export const i = 1;"],
		["class declaration", "export class J {}"],
		["enum declaration", "export enum K { A = 0 }"],
		["side-effect import", 'import "./polyfill";'],
		["value import", 'import { run } from "./lib";\nrun();'],
		[
			"interface alongside a runtime statement",
			"export interface L { a: number; }\nexport const m = 1;",
		],
		[
			"re-export alongside a runtime statement",
			'export { run } from "./lib";\nexport const started = true;',
		],
	])("should reject %s as runtime-emitting", ([, source]) => {
		expect.assertions(1);

		expect(isTypesOnlyModule(source)).toBeFalse();
	});
});
