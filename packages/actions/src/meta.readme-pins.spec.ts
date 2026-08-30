import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const README = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
const MANIFEST = readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");

// Floor guarding against a regex regression passing the suite on an empty match
// set. Raise it if the public surface ever documents more pins.
const MINIMUM_PINS = 4;

// The exact triple is what `pnpm version -r` moves and what release.yaml cuts
// the tag from. A bare `actions-v<major>` names the moving alias instead, which
// tracks no manifest version.
const EXACT_PIN = /actions-v\d+\.\d+\.\d+/gu;

function exactPins(markdown: string): ReadonlyArray<string> {
	return markdown.match(EXACT_PIN) ?? [];
}

describe("@bedrock-rbx/actions README version pins", () => {
	it("should collect the exact-triple pins and leave the major alias alone", () => {
		expect.assertions(1);

		expect(exactPins("@actions-v0.1.1 @actions-v1 @actions-v10.2.30")).toStrictEqual([
			"actions-v0.1.1",
			"actions-v10.2.30",
		]);
	});

	it("should read a non-trivial set of pins out of the README", () => {
		expect.assertions(1);

		expect(exactPins(README).length).toBeGreaterThanOrEqual(MINIMUM_PINS);
	});

	it("should pin every README example to the packaged version", () => {
		expect.assertions(1);

		const manifest = JSON.parse(MANIFEST);
		assert(typeof manifest === "object" && !!manifest && !Array.isArray(manifest));
		const { version } = manifest;
		assert(typeof version === "string");

		const stale = [...new Set(exactPins(README))].filter(
			(pin) => pin !== `actions-v${version}`,
		);

		expect(stale).toStrictEqual([]);
	});
});
