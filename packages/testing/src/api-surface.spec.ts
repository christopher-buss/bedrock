import path from "node:path";
import { describe, expect, it } from "vitest";

import { barrelSourcePaths, collectPublicApiSymbols, type ReadSource } from "./api-surface.ts";

const BARREL = path.resolve("/virtual/pkg/src/index.ts");
const ROOT = path.resolve("/virtual/pkg");

function moduleMap(modules: Record<string, string>): ReadSource {
	const resolved = new Map<string, string>();
	for (const [relative, source] of Object.entries(modules)) {
		resolved.set(path.resolve("/virtual/pkg/src", relative), source);
	}

	return (absolutePath) => {
		const source = resolved.get(absolutePath);
		if (source === undefined) {
			throw new Error(`unexpected read: ${absolutePath}`);
		}

		return source;
	};
}

function declarationFileOf(relative: string): string {
	return path.resolve("/virtual/pkg/src", relative);
}

describe(collectPublicApiSymbols, () => {
	it("should collect a value re-exported from a relative module", () => {
		expect.assertions(1);

		const read = moduleMap({
			"core/diff.ts": "export function diff() {}",
			"index.ts": 'export { diff } from "./core/diff.ts";',
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([
			{
				name: "diff",
				declarationFile: declarationFileOf("core/diff.ts"),
				sinceTag: undefined,
			},
		]);
	});

	it("should collect every name in a multi-name re-export", () => {
		expect.assertions(1);

		const read = moduleMap({
			"core/price.ts":
				"export interface PriceFields {}\nexport function derivePriceFields() {}",
			"index.ts": 'export { type PriceFields, derivePriceFields } from "./core/price.ts";',
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([
			{
				name: "PriceFields",
				declarationFile: declarationFileOf("core/price.ts"),
				sinceTag: undefined,
			},
			{
				name: "derivePriceFields",
				declarationFile: declarationFileOf("core/price.ts"),
				sinceTag: undefined,
			},
		]);
	});

	it("should collect type-only re-exports", () => {
		expect.assertions(1);

		const read = moduleMap({
			"cli/render.ts": "export interface ClackPort {}",
			"index.ts": 'export type { ClackPort } from "./cli/render.ts";',
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([
			{
				name: "ClackPort",
				declarationFile: declarationFileOf("cli/render.ts"),
				sinceTag: undefined,
			},
		]);
	});

	it("should skip names re-exported from another package", () => {
		expect.assertions(1);

		const read = moduleMap({
			"core/diff.ts": "export function diff() {}",
			"index.ts": [
				'export { OpenCloudError } from "@bedrock-rbx/ocale";',
				'export { diff } from "./core/diff.ts";',
			].join("\n"),
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([
			{
				name: "diff",
				declarationFile: declarationFileOf("core/diff.ts"),
				sinceTag: undefined,
			},
		]);
	});

	it("should follow a re-export chain through an intermediate index to the declaration", () => {
		expect.assertions(1);

		const read = moduleMap({
			"core/kinds/index.ts": 'export { defaultKindRegistry } from "./registry.ts";',
			"core/kinds/registry.ts": "export const defaultKindRegistry = {};",
			"index.ts": 'export { defaultKindRegistry } from "./core/kinds/index.ts";',
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([
			{
				name: "defaultKindRegistry",
				declarationFile: declarationFileOf("core/kinds/registry.ts"),
				sinceTag: undefined,
			},
		]);
	});

	it("should drop a name whose re-export chain leaves the package", () => {
		expect.assertions(1);

		const read = moduleMap({
			"index.ts": 'export { Result } from "./re-export.ts";',
			"re-export.ts": 'export { Result } from "@bedrock-rbx/ocale";',
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([]);
	});

	it("should read the @since version from the declaration's JSDoc", () => {
		expect.assertions(1);

		const read = moduleMap({
			"core/diff.ts":
				"/**\n * Diffs two states.\n *\n * @since 0.1.0\n */\nexport function diff() {}",
			"index.ts": 'export { diff } from "./core/diff.ts";',
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([
			{ name: "diff", declarationFile: declarationFileOf("core/diff.ts"), sinceTag: "0.1.0" },
		]);
	});

	it("should report an undefined sinceTag when the declaration has no @since", () => {
		expect.assertions(1);

		const read = moduleMap({
			"core/diff.ts": "/** Diffs two states. */\nexport function diff() {}",
			"index.ts": 'export { diff } from "./core/diff.ts";',
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols[0]?.sinceTag).toBeUndefined();
	});

	it("should ignore imports and local exports in the barrel", () => {
		expect.assertions(1);

		const read = moduleMap({
			"core/diff.ts": "export function diff() {}",
			"index.ts": [
				'import process from "node:process";',
				"export const LOCAL = 1;",
				'export { diff } from "./core/diff.ts";',
			].join("\n"),
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([
			{
				name: "diff",
				declarationFile: declarationFileOf("core/diff.ts"),
				sinceTag: undefined,
			},
		]);
	});

	it("should not follow star re-exports", () => {
		expect.assertions(1);

		const read = moduleMap({
			"index.ts": 'export * from "./everything.ts";',
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([]);
	});

	it("should drop a name the target module neither declares nor re-exports", () => {
		expect.assertions(1);

		const read = moduleMap({
			"index.ts": 'export { Missing } from "./middle.ts";',
			"middle.ts": [
				'import foo from "node:foo";',
				'export { Other } from "./other.ts";',
			].join("\n"),
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols).toStrictEqual([]);
	});

	it("should read @since from the final declaration in a re-export chain", () => {
		expect.assertions(1);

		const read = moduleMap({
			"core/kinds/index.ts": 'export { defaultKindRegistry } from "./registry.ts";',
			"core/kinds/registry.ts":
				"/**\n * Default registry.\n *\n * @since 2.3.0\n */\nexport const defaultKindRegistry = {};",
			"index.ts": 'export { defaultKindRegistry } from "./core/kinds/index.ts";',
		});

		const symbols = collectPublicApiSymbols(BARREL, read);

		expect(symbols[0]?.sinceTag).toBe("2.3.0");
	});
});

describe(barrelSourcePaths, () => {
	it("should return the source path of every src .ts entry point", () => {
		expect.assertions(1);

		const manifest = JSON.stringify({
			exports: {
				".": { default: "./dist/index.mjs", source: "./src/index.ts" },
				"./config": { default: "./dist/config.mjs", source: "./src/config.ts" },
			},
		});

		const paths = barrelSourcePaths(manifest, ROOT);

		expect(paths).toStrictEqual([
			path.resolve(ROOT, "./src/index.ts"),
			path.resolve(ROOT, "./src/config.ts"),
		]);
	});

	it("should exclude string entries and non-src sources", () => {
		expect.assertions(1);

		const manifest = JSON.stringify({
			exports: {
				".": { source: "./src/index.ts" },
				"./package.json": "./package.json",
				"./testing": { source: "./tests/helpers/index.ts" },
			},
		});

		const paths = barrelSourcePaths(manifest, ROOT);

		expect(paths).toStrictEqual([path.resolve(ROOT, "./src/index.ts")]);
	});

	it("should return no paths when the manifest has no exports", () => {
		expect.assertions(1);

		const paths = barrelSourcePaths('{ "name": "pkg" }', ROOT);

		expect(paths).toStrictEqual([]);
	});
});
