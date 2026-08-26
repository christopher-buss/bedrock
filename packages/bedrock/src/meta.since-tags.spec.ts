import { barrelSourcePaths, collectPublicApiSymbols } from "@bedrock-rbx/testing/api-surface";
import { isValidSinceTag, publishedVersion } from "@bedrock-rbx/testing/since-tags";

import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
// Floor guarding against a barrel-discovery regression silently passing the
// suite. Raise it if the public surface ever shrinks below this.
const MINIMUM_PUBLIC_SYMBOLS = 80;

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
		const barrelSymbols = collectPublicApiSymbols(barrel, (file) => readFileSync(file, "utf8"));
		for (const symbol of barrelSymbols) {
			const key = `${symbol.declarationFile}#${symbol.name}`;
			if (!seen.has(key)) {
				seen.add(key);
				symbols.push(symbol);
			}
		}
	}

	return symbols;
}

describe("@bedrock-rbx/core public API @since coverage", () => {
	it("should expose a non-trivial public surface to guard", () => {
		expect.assertions(1);

		expect(publicSymbols().length).toBeGreaterThanOrEqual(MINIMUM_PUBLIC_SYMBOLS);
	});

	it("should carry a valid @since tag on every public symbol", () => {
		expect.assertions(1);

		const currentVersion = publishedVersion(MANIFEST);
		assert(currentVersion !== undefined);

		const offenders = publicSymbols()
			.filter((symbol) => !isValidSinceTag(symbol.sinceTag, currentVersion))
			.map((symbol) => {
				return `${symbol.name} (${path.relative(PACKAGE_ROOT, symbol.declarationFile)})`;
			});

		expect(offenders).toStrictEqual([]);
	});
});
