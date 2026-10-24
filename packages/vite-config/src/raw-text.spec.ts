import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import { rawText } from "./raw-text.ts";

describe("rawText", () => {
	it("should load a ?raw id as a module exporting the file's text", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const directory = mkdtempSync(join(tmpdir(), "raw-text-"));
		onTestFinished(() => {
			rmSync(directory, { force: true, recursive: true });
		});
		const file = join(directory, "config.luau");
		writeFileSync(file, 'local x = "y"\n');

		await expect(rawText.load(`${file}?raw`)).resolves.toBe(
			'export default "local x = \\"y\\"\\n";',
		);
	});

	it("should leave ids without ?raw to other plugins", async ({ expect }) => {
		expect.assertions(1);

		await expect(rawText.load("/src/index.ts")).resolves.toBeUndefined();
	});

	it("should resolve a ?raw import relative to its importer", ({ expect }) => {
		expect.assertions(1);

		expect(rawText.resolveId("./config.luau?raw", "/pkg/src/luau/config-source.ts")).toBe(
			"/pkg/src/luau/config.luau?raw",
		);
	});

	it.for<[string, string | undefined]>([
		["./config.luau", "/pkg/src/index.ts"],
		["./config.luau?raw", undefined],
	])("should not resolve %s imported from %s", ([source, importer], { expect }) => {
		expect.assertions(1);

		expect(rawText.resolveId(source, importer)).toBeUndefined();
	});
});
