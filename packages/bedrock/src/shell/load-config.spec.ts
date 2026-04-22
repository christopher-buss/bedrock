import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, expect, it } from "vitest";

import { loadConfig } from "./load-config.ts";

async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-load-config-"));
	try {
		return await run(directory);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

function writeFixtureConfig(directory: string, lines: ReadonlyArray<string>): void {
	writeFileSync(join(directory, "bedrock.config.ts"), lines.join("\n"));
}

async function expectParseFailed(filename: string, contents: string): Promise<void> {
	await withTemporaryDirectory(async (cwd) => {
		writeFileSync(join(cwd, filename), contents);
		writeFileSync(join(cwd, "_decoy.txt"), "unrelated");

		const result = await loadConfig({ cwd });

		assert(!result.success);
		assert(result.err.kind === "parseFailed");

		expect(result.err.kind).toBe("parseFailed");
		expect(result.err.sourceFile).toBe(join(cwd, filename));
		expect(result.err.message.length).toBeGreaterThan(0);
	});
}

describe(loadConfig, () => {
	it("should load a TypeScript config file declared with defineConfig", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"import { defineConfig } from 'bedrock';",
				"export default defineConfig({",
				"  passes: {",
				"    'vip-pass': {",
				"      description: 'Grants VIP perks.',",
				"      iconFilePath: 'assets/vip-icon.png',",
				"      name: 'VIP Pass',",
				"      price: 500,",
				"    },",
				"  },",
				"});",
			]);

			const result = await loadConfig({ cwd });

			assert(result.success);

			expect(result.data.passes!["vip-pass"]!.name).toBe("VIP Pass");
		});
	});

	it("should return a fileNotFound error when no config file is present", async () => {
		expect.assertions(2);

		await withTemporaryDirectory(async (cwd) => {
			const result = await loadConfig({ cwd });

			assert(!result.success);
			assert(result.err.kind === "fileNotFound");

			expect(result.err.kind).toBe("fileNotFound");
			expect(result.err.searchedFrom).toBe(cwd);
		});
	});

	it("should return a validationFailed error attributed to the config file when content is invalid", async () => {
		expect.assertions(2);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"export default {",
				"  passes: {",
				"    'vip-pass': {",
				"      description: 'Bad price.',",
				"      iconFilePath: 'assets/vip.png',",
				"      name: 'VIP',",
				"      price: 'oops',",
				"    },",
				"  },",
				"};",
			]);

			const result = await loadConfig({ cwd });

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.sourceFile).toMatch(/bedrock\.config\.ts$/);
			expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "price"]);
		});
	});

	it("should return a parseFailed error when a YAML config file is malformed", async () => {
		expect.assertions(3);

		await expectParseFailed(
			"bedrock.config.yaml",
			["passes:", "  vip-pass:", '    name: "VIP Pass', "    price: 500", ""].join("\n"),
		);
	});

	it("should return a parseFailed error when a JSON config file is malformed", async () => {
		expect.assertions(3);

		await expectParseFailed(
			"bedrock.config.json",
			'{ "passes": { "vip-pass": { "name": "VIP Pass", } } }\n',
		);
	});

	it("should return a fresh copy on each call so mutation does not leak between invocations", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"export default {",
				"  passes: {",
				"    'vip-pass': {",
				"      description: 'd',",
				"      iconFilePath: 'p',",
				"      name: 'VIP',",
				"      price: 500,",
				"    },",
				"  },",
				"};",
			]);

			const first = await loadConfig({ cwd });
			assert(first.success);
			first.data.passes!["vip-pass"]!.price = 9999;

			const second = await loadConfig({ cwd });
			assert(second.success);

			expect(second.data.passes!["vip-pass"]!.price).toBe(500);
		});
	});
});
