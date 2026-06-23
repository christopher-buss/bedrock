import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectPublicApiSymbols, type ReadSource } from "./api-surface.ts";

const BARREL = path.resolve("/virtual/pkg/src/index.ts");

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
});
