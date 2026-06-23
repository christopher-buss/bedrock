import { barrelSourcePaths, collectPublicApiSymbols } from "@bedrock-rbx/testing/api-surface";

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[\dA-Za-z.-]+)?$/;
// Floor guarding against a barrel-discovery regression silently passing the
// suite. Raise it if the public surface ever shrinks below this.
const MINIMUM_PUBLIC_SYMBOLS = 50;

function publicSymbols(): Array<{
	declarationFile: string;
	name: string;
	sinceTag: string | undefined;
}> {
	const manifest = readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
	const seen = new Set<string>();
	const symbols: Array<{ declarationFile: string; name: string; sinceTag: string | undefined }> =
		[];
	for (const barrel of barrelSourcePaths(manifest, PACKAGE_ROOT)) {
		for (const symbol of collectPublicApiSymbols(barrel, (file) =>
			readFileSync(file, "utf8"),
		)) {
			const key = `${symbol.declarationFile}#${symbol.name}`;
			if (!seen.has(key)) {
				seen.add(key);
				symbols.push(symbol);
			}
		}
	}

	return symbols;
}

describe("@bedrock-rbx/ocale public API @since coverage", () => {
	it("should expose a non-trivial public surface to guard", () => {
		expect.assertions(1);

		expect(publicSymbols().length).toBeGreaterThanOrEqual(MINIMUM_PUBLIC_SYMBOLS);
	});

	it("should carry a valid @since tag on every public symbol", () => {
		expect.assertions(1);

		const offenders = publicSymbols()
			.filter((symbol) => symbol.sinceTag === undefined || !SEMVER.test(symbol.sinceTag))
			.map(
				(symbol) =>
					`${symbol.name} (${path.relative(PACKAGE_ROOT, symbol.declarationFile)})`,
			);

		expect(offenders).toStrictEqual([]);
	});
});
