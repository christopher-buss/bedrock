import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { importPluginModuleAsync } from "./dynamic-module-importer.ts";

function createProjectDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-plugin-importer-"));

	onTestFinished(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	return directory;
}

function writePluginFile(path: string, name: string): void {
	writeFileSync(path, `export default { name: ${JSON.stringify(name)} };\n`);
}

function writePluginPackage(projectDirectory: string, packageName: string): void {
	const packageDirectory = join(projectDirectory, "node_modules", packageName);
	mkdirSync(packageDirectory, { recursive: true });
	writeFileSync(
		join(packageDirectory, "package.json"),
		JSON.stringify({
			name: packageName,
			exports: { ".": { import: "./index.mjs" } },
			type: "module",
			version: "1.0.0",
		}),
	);
	writePluginFile(join(packageDirectory, "index.mjs"), packageName);
}

describe(importPluginModuleAsync, () => {
	it("should import a package installed under the given directory rather than under bedrock", async () => {
		expect.assertions(1);

		const projectDirectory = createProjectDirectory();
		writePluginPackage(projectDirectory, "example-plugin");

		const module = await importPluginModuleAsync("example-plugin", projectDirectory);

		expect(module).toHaveProperty("default.name", "example-plugin");
	});

	it.for([
		["a path naming the file", "./tools/local.mjs"],
		["a path with the extension left off", "./tools/local"],
		["a path naming the containing directory", "./tools"],
	] as const)("should import a plugin from %s", async ([, specifier]) => {
		expect.assertions(1);

		const projectDirectory = createProjectDirectory();
		mkdirSync(join(projectDirectory, "tools"), { recursive: true });
		writePluginFile(join(projectDirectory, "tools", "local.mjs"), "local");
		writePluginFile(join(projectDirectory, "tools", "index.mjs"), "local");

		const module = await importPluginModuleAsync(specifier, projectDirectory);

		expect(module).toHaveProperty("default.name", "local");
	});

	it("should reject with the module-not-found code when the specifier resolves to nothing", async () => {
		expect.assertions(1);

		const projectDirectory = createProjectDirectory();

		const rejection = await importPluginModuleAsync("nope-plugin", projectDirectory).catch(
			(err: unknown) => err,
		);

		expect(rejection).toHaveProperty("code", "ERR_MODULE_NOT_FOUND");
	});
});
