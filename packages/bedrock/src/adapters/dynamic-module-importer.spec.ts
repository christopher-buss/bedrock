import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, expect, it, onTestFinished } from "vitest";

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

		const result = await importPluginModuleAsync("example-plugin", projectDirectory);

		assert(result.success);

		expect(result.data).toHaveProperty("default.name", "example-plugin");
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

		const result = await importPluginModuleAsync(specifier, projectDirectory);

		assert(result.success);

		expect(result.data).toHaveProperty("default.name", "local");
	});

	it("should report resolutionFailed when the specifier resolves to nothing", async () => {
		expect.assertions(2);

		const projectDirectory = createProjectDirectory();

		const result = await importPluginModuleAsync("nope-plugin", projectDirectory);

		assert(!result.success);

		expect(result.err.kind).toBe("resolutionFailed");
		expect(result.err.message.length).toBeGreaterThan(0);
	});

	it("should report evaluationFailed when a resolved plugin's own dependency is missing", async () => {
		expect.assertions(2);

		const projectDirectory = createProjectDirectory();
		writePluginPackage(projectDirectory, "example-plugin");
		writeFileSync(
			join(projectDirectory, "node_modules", "example-plugin", "index.mjs"),
			'import "@nope/not-installed";\nexport default { name: "example-plugin" };\n',
		);

		const result = await importPluginModuleAsync("example-plugin", projectDirectory);

		assert(!result.success);

		expect(result.err.kind).toBe("evaluationFailed");
		expect(result.err.message.length).toBeGreaterThan(0);
	});
});
