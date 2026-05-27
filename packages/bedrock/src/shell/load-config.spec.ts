import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

import { bootstrapDirectoryPrefix } from "./load-config-internal.ts";
import { loadConfig, loadConfigWith } from "./load-config.ts";

// Walking up from a temp file inside the workspace tree finds @bedrock-rbx/core
// via the workspace root's node_modules, regardless of pnpm's hoist decisions.
// node_modules/.cache is the conventional location for tool ephemera and is
// already gitignored.
const WORKSPACE_TEMP_ROOT = join(
	dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
	"node_modules",
	".cache",
);

async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
	mkdirSync(WORKSPACE_TEMP_ROOT, { recursive: true });
	const directory = mkdtempSync(join(WORKSPACE_TEMP_ROOT, "bedrock-load-config-"));
	try {
		return await run(directory);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

function writeFixtureConfig(directory: string, lines: ReadonlyArray<string>): void {
	writeFileSync(join(directory, "bedrock.config.ts"), lines.join("\n"));
}

function readBootstrapDirectories(): Array<string> {
	const selfPrefix = bootstrapDirectoryPrefix(process.pid);
	return readdirSync(tmpdir()).filter((entry) => entry.startsWith(selfPrefix));
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
				"import { defineConfig } from '@bedrock-rbx/core';",
				"export default defineConfig({",
				"  environments: { production: {} },",
				"  passes: {",
				"    'vip-pass': {",
				"      description: 'Grants VIP perks.',",
				"      icon: { 'en-us': 'assets/vip-icon.png' },",
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

	it("should load a TypeScript config declared with a synchronous defineConfig function", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"import { defineConfig } from '@bedrock-rbx/core';",
				"export default defineConfig(() => ({",
				"  environments: { production: {} },",
				"  passes: {",
				"    'vip-pass': {",
				"      description: 'Grants VIP perks.',",
				"      icon: { 'en-us': 'assets/vip-icon.png' },",
				"      name: 'VIP Pass',",
				"      price: 500,",
				"    },",
				"  },",
				"}));",
			]);

			const result = await loadConfig({ cwd });

			assert(result.success);

			expect(result.data.passes!["vip-pass"]!.name).toBe("VIP Pass");
		});
	});

	it("should load a TypeScript config declared with an asynchronous defineConfig function", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"import { defineConfig } from '@bedrock-rbx/core';",
				"export default defineConfig(async () => ({",
				"  environments: { production: {} },",
				"  passes: {",
				"    'vip-pass': {",
				"      description: 'Grants VIP perks.',",
				"      icon: { 'en-us': 'assets/vip-icon.png' },",
				"      name: 'VIP Pass (async)',",
				"      price: 750,",
				"    },",
				"  },",
				"}));",
			]);

			const result = await loadConfig({ cwd });

			assert(result.success);

			expect(result.data.passes!["vip-pass"]!.name).toBe("VIP Pass (async)");
		});
	});

	it("should return a configFunctionFailed error when a synchronous config function throws", async () => {
		expect.assertions(3);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"import { defineConfig } from '@bedrock-rbx/core';",
				"export default defineConfig(() => {",
				"  throw new Error('sync boom');",
				"});",
			]);

			const result = await loadConfig({ cwd });

			assert(!result.success);
			assert(result.err.kind === "configFunctionFailed");

			expect(result.err.kind).toBe("configFunctionFailed");
			expect(result.err.sourceFile).toMatch(/\/.+\/bedrock\.config\.ts$/);
			expect(result.err.message).toBe("sync boom");
		});
	});

	it("should return a configFunctionFailed error when an asynchronous config function rejects", async () => {
		expect.assertions(3);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"import { defineConfig } from '@bedrock-rbx/core';",
				"export default defineConfig(async () => {",
				"  throw new Error('async boom');",
				"});",
			]);

			const result = await loadConfig({ cwd });

			assert(!result.success);
			assert(result.err.kind === "configFunctionFailed");

			expect(result.err.kind).toBe("configFunctionFailed");
			expect(result.err.sourceFile).toMatch(/\/.+\/bedrock\.config\.ts$/);
			expect(result.err.message).toBe("async boom");
		});
	});

	it("should surface a non-Error throw from a config function as parseFailed", async () => {
		expect.assertions(2);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"import { defineConfig } from '@bedrock-rbx/core';",
				"export default defineConfig(() => {",
				"  throw 'bare string boom';",
				"});",
			]);

			const result = await loadConfig({ cwd });

			assert(!result.success);
			assert(result.err.kind === "parseFailed");

			expect(result.err.kind).toBe("parseFailed");
			expect(result.err.message).toContain("bare string boom");
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

	it("should load the config file at the path given via configFile", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			writeFileSync(
				join(cwd, "bedrock.staging.config.yaml"),
				[
					"environments:",
					"  staging: {}",
					"passes:",
					"  staging-pass:",
					"    description: Staging perks.",
					"    icon:",
					"      en-us: assets/staging.png",
					"    name: Staging Pass",
					"    price: 100",
					"",
				].join("\n"),
			);

			const result = await loadConfig({ configFile: "bedrock.staging.config.yaml", cwd });

			assert(result.success);

			expect(result.data.passes!["staging-pass"]!.name).toBe("Staging Pass");
		});
	});

	it("should resolve a relative configFile against cwd and not search alternate extensions", async () => {
		expect.assertions(2);

		await withTemporaryDirectory(async (cwd) => {
			writeFileSync(
				join(cwd, "bedrock.staging.config.ts"),
				[
					"import { defineConfig } from '@bedrock-rbx/core';",
					"export default defineConfig({ passes: {} });",
				].join("\n"),
			);

			const result = await loadConfig({ configFile: "bedrock.staging.config", cwd });

			assert(!result.success);
			assert(result.err.kind === "fileNotFound");

			expect(result.err.kind).toBe("fileNotFound");
			expect(result.err.searchedFrom).toBe(cwd);
		});
	});

	it("should accept an absolute configFile path", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			const absolutePath = join(cwd, "elsewhere.config.ts");
			writeFileSync(
				absolutePath,
				[
					"import { defineConfig } from '@bedrock-rbx/core';",
					"export default defineConfig({",
					"  environments: { production: {} },",
					"  passes: {",
					"    'absolute-pass': {",
					"      description: 'Loaded by absolute path.',",
					"      icon: { 'en-us': 'assets/abs.png' },",
					"      name: 'Absolute Pass',",
					"      price: 200,",
					"    },",
					"  },",
					"});",
				].join("\n"),
			);

			const result = await loadConfig({ configFile: absolutePath });

			assert(result.success);

			expect(result.data.passes!["absolute-pass"]!.name).toBe("Absolute Pass");
		});
	});

	it("should return a validationFailed error attributed to the config file when content is invalid", async () => {
		expect.assertions(2);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"export default {",
				"  environments: { production: {} },",
				"  passes: {",
				"    'vip-pass': {",
				"      description: 'Bad price.',",
				"      icon: { 'en-us': 'assets/vip.png' },",
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

	it.skipIf(!HAS_LUTE)("should load a Luau config file via Lute", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			writeFileSync(
				join(cwd, "bedrock.config.luau"),
				[
					"return {",
					"  environments = { production = {} },",
					"  passes = {",
					"    ['vip-pass'] = {",
					"      description = 'Grants VIP perks.',",
					"      icon = { ['en-us'] = 'assets/vip-icon.png' },",
					"      name = 'VIP Pass',",
					"      price = 500,",
					"    },",
					"  },",
					"}",
					"",
				].join("\n"),
			);

			const result = await loadConfig({ cwd });

			assert(result.success);

			expect(result.data.passes!["vip-pass"]!.name).toBe("VIP Pass");
		});
	});

	it.skipIf(!HAS_LUTE)(
		"should return a parseFailed error attributed to the file when a Luau config returns a non-serializable value",
		async () => {
			expect.assertions(3);

			await withTemporaryDirectory(async (cwd) => {
				writeFileSync(
					join(cwd, "bedrock.config.luau"),
					[
						"return {",
						"  -- Function-valued field cannot be JSON-encoded; bootstrap must fail loudly.",
						"  computed = function() return 42 end,",
						"}",
						"",
					].join("\n"),
				);

				const result = await loadConfig({ cwd });

				assert(!result.success);
				assert(result.err.kind === "parseFailed");

				expect(result.err.sourceFile).toBe(join(cwd, "bedrock.config.luau"));
				expect(result.err.message).toContain("Unknown value");
				expect(result.err.message).not.toContain("__BEDROCK_LUAU_");
			});
		},
	);

	it("should return a luauRuntimeMissing error when no lute binary is reachable", async () => {
		expect.assertions(3);

		await withTemporaryDirectory(async (cwd) => {
			writeFileSync(
				join(cwd, "bedrock.config.luau"),
				["return { passes = {} }", ""].join("\n"),
			);

			const previous = process.env["BEDROCK_LUTE_PATH"];
			process.env["BEDROCK_LUTE_PATH"] = "/nonexistent/path/to/lute-binary-xyz";
			let result: Awaited<ReturnType<typeof loadConfig>>;
			try {
				result = await loadConfig({ cwd });
			} finally {
				if (previous === undefined) {
					delete process.env["BEDROCK_LUTE_PATH"];
				} else {
					process.env["BEDROCK_LUTE_PATH"] = previous;
				}
			}

			assert(!result.success);
			assert(result.err.kind === "luauRuntimeMissing");

			expect(result.err.kind).toBe("luauRuntimeMissing");
			expect(result.err.sourceFile).toBe(join(cwd, "bedrock.config.luau"));
			expect(result.err.hint).toContain("BEDROCK_LUTE_PATH");
		});
	});

	it.skipIf(!HAS_LUTE)(
		"should layer a Luau base config when the main TypeScript config extends it",
		async () => {
			expect.assertions(2);

			await withTemporaryDirectory(async (cwd) => {
				writeFileSync(
					join(cwd, "base.luau"),
					[
						"return {",
						"  passes = {",
						"    ['vip-pass'] = {",
						"      description = 'Grants VIP perks.',",
						"      icon = { ['en-us'] = 'assets/vip-icon.png' },",
						"      name = 'VIP Pass',",
						"      price = 500,",
						"    },",
						"  },",
						"}",
						"",
					].join("\n"),
				);
				writeFixtureConfig(cwd, [
					"export default {",
					"  extends: './base.luau',",
					"  environments: { production: {} },",
					"  passes: {",
					"    'gold-pass': {",
					"      description: 'Gold tier perks.',",
					"      icon: { 'en-us': 'assets/gold-icon.png' },",
					"      name: 'Gold Pass',",
					"      price: 1000,",
					"    },",
					"  },",
					"};",
				]);

				const result = await loadConfig({ cwd });

				assert(result.success);

				expect(result.data.passes!["vip-pass"]!.name).toBe("VIP Pass");
				expect(result.data.passes!["gold-pass"]!.name).toBe("Gold Pass");
			});
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should defer to a TypeScript sibling when both bedrock.config.ts and bedrock.config.luau exist",
		async () => {
			expect.assertions(1);

			await withTemporaryDirectory(async (cwd) => {
				writeFixtureConfig(cwd, [
					"export default {",
					"  environments: { production: {} },",
					"  passes: {",
					"    'vip-pass': {",
					"      description: 'TS wins.',",
					"      icon: { 'en-us': 'assets/vip-icon.png' },",
					"      name: 'TS Pass',",
					"      price: 500,",
					"    },",
					"  },",
					"};",
				]);
				writeFileSync(
					join(cwd, "bedrock.config.luau"),
					[
						"return {",
						"  passes = {",
						"    ['vip-pass'] = {",
						"      description = 'Luau loses.',",
						"      icon = { ['en-us'] = 'assets/vip-icon.png' },",
						"      name = 'Luau Pass',",
						"      price = 500,",
						"    },",
						"  },",
						"}",
						"",
					].join("\n"),
				);

				const result = await loadConfig({ cwd });

				assert(result.success);

				expect(result.data.passes!["vip-pass"]!.name).toBe("TS Pass");
			});
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should evaluate a Luau file when configFile names it explicitly",
		async () => {
			expect.assertions(1);

			await withTemporaryDirectory(async (cwd) => {
				writeFileSync(
					join(cwd, "bedrock.staging.config.luau"),
					[
						"return {",
						"  environments = { staging = {} },",
						"  passes = {",
						"    ['vip-pass'] = {",
						"      description = 'Staging perks.',",
						"      icon = { ['en-us'] = 'assets/staging.png' },",
						"      name = 'Staging Pass',",
						"      price = 100,",
						"    },",
						"  },",
						"}",
						"",
					].join("\n"),
				);

				const result = await loadConfig({
					configFile: "bedrock.staging.config.luau",
					cwd,
				});

				assert(result.success);

				expect(result.data.passes!["vip-pass"]!.name).toBe("Staging Pass");
			});
		},
	);

	it.skipIf(!HAS_LUTE)("should reject a Luau config that returns a non-table value", async () => {
		expect.assertions(2);

		await withTemporaryDirectory(async (cwd) => {
			writeFileSync(join(cwd, "bedrock.config.luau"), "return 42\n");

			const result = await loadConfig({ cwd });

			assert(!result.success);
			assert(result.err.kind === "parseFailed");

			expect(result.err.sourceFile).toBe(join(cwd, "bedrock.config.luau"));
			expect(result.err.message).toContain("table at the root");
		});
	});

	it.skipIf(!HAS_LUTE)(
		"should fall back to the PATH lute when BEDROCK_LUTE_PATH is set to an empty string",
		async () => {
			expect.assertions(1);

			await withTemporaryDirectory(async (cwd) => {
				writeFileSync(
					join(cwd, "bedrock.config.luau"),
					["return { environments = { production = {} }, passes = {} }", ""].join("\n"),
				);

				const previous = process.env["BEDROCK_LUTE_PATH"];
				process.env["BEDROCK_LUTE_PATH"] = "";
				let result: Awaited<ReturnType<typeof loadConfig>>;
				try {
					result = await loadConfig({ cwd });
				} finally {
					if (previous === undefined) {
						delete process.env["BEDROCK_LUTE_PATH"];
					} else {
						process.env["BEDROCK_LUTE_PATH"] = previous;
					}
				}

				// An empty override must be treated as "not set" so the loader
				// falls through to `lute` on PATH; gating on `length > 0` is what
				// makes that fallback observable.
				expect(result.success).toBeTrue();
			});
		},
	);

	// Not gated on HAS_LUTE: the cleanup runs in `finally` whether lute spawns
	// successfully or fails with ENOENT, so the test exercises the same
	// behaviour either way.
	it("should remove the bootstrap temp directory after evaluating a Luau config", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			writeFileSync(
				join(cwd, "bedrock.config.luau"),
				["return { passes = {} }", ""].join("\n"),
			);

			const before = new Set(readBootstrapDirectories());

			await loadConfig({ cwd });

			const after = readBootstrapDirectories();
			const leaked = after.filter((entry) => !before.has(entry));

			expect(leaked).toStrictEqual([]);
		});
	});

	it("should surface a parseFailed error when the Luau evaluator returns evaluationFailed", async () => {
		expect.assertions(3);

		await withTemporaryDirectory(async (cwd) => {
			const luauPath = join(cwd, "bedrock.config.luau");
			writeFileSync(luauPath, ["return { passes = {} }", ""].join("\n"));

			async function evaluator(): Promise<
				Awaited<ReturnType<Parameters<typeof loadConfigWith>[0]["evaluator"]>>
			> {
				return {
					err: { kind: "evaluationFailed", message: "evaluator timed out" },
					success: false,
				};
			}

			const result = await loadConfigWith({ evaluator }, { cwd });

			assert(!result.success);
			assert(result.err.kind === "parseFailed");

			expect(result.err.kind).toBe("parseFailed");
			expect(result.err.message).toBe("evaluator timed out");
			expect(result.err.sourceFile).toBe(luauPath);
		});
	});

	it.skipIf(!HAS_LUTE)(
		"should surface a non-ENOENT spawn failure as parseFailed rather than luauRuntimeMissing",
		async () => {
			expect.assertions(1);

			await withTemporaryDirectory(async (cwd) => {
				writeFileSync(
					join(cwd, "bedrock.config.luau"),
					["return { passes = {} }", ""].join("\n"),
				);

				const previous = process.env["BEDROCK_LUTE_PATH"];
				// Runtime binary exists, then exits non-zero for Lute args.
				process.env["BEDROCK_LUTE_PATH"] = process.execPath;
				let result: Awaited<ReturnType<typeof loadConfig>>;
				try {
					result = await loadConfig({ cwd });
				} finally {
					if (previous === undefined) {
						delete process.env["BEDROCK_LUTE_PATH"];
					} else {
						process.env["BEDROCK_LUTE_PATH"] = previous;
					}
				}

				assert(!result.success);

				expect(result.err.kind).toBe("parseFailed");
			});
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should layer extends from a Luau configFile when it references another Luau file",
		async () => {
			expect.assertions(2);

			await withTemporaryDirectory(async (cwd) => {
				writeFileSync(
					join(cwd, "base.luau"),
					[
						"return {",
						"  passes = {",
						"    ['vip-pass'] = {",
						"      description = 'VIP perks.',",
						"      icon = { ['en-us'] = 'assets/vip.png' },",
						"      name = 'VIP Pass',",
						"      price = 500,",
						"    },",
						"  },",
						"}",
						"",
					].join("\n"),
				);
				writeFileSync(
					join(cwd, "bedrock.staging.config.luau"),
					[
						"return {",
						"  extends = './base.luau',",
						"  environments = { staging = {} },",
						"  passes = {",
						"    ['gold-pass'] = {",
						"      description = 'Gold tier perks.',",
						"      icon = { ['en-us'] = 'assets/gold.png' },",
						"      name = 'Gold Pass',",
						"      price = 1000,",
						"    },",
						"  },",
						"}",
						"",
					].join("\n"),
				);

				const result = await loadConfig({
					configFile: "bedrock.staging.config.luau",
					cwd,
				});

				assert(result.success);

				expect(result.data.passes!["vip-pass"]!.name).toBe("VIP Pass");
				expect(result.data.passes!["gold-pass"]!.name).toBe("Gold Pass");
			});
		},
	);

	it("should discover bedrock.config.ts inside .bedrock/ when the project root has no config", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			const bedrockDirectory = join(cwd, ".bedrock");
			mkdirSync(bedrockDirectory, { recursive: true });
			writeFileSync(
				join(bedrockDirectory, "bedrock.config.ts"),
				[
					"import { defineConfig } from '@bedrock-rbx/core';",
					"export default defineConfig({",
					"  environments: { production: {} },",
					"  passes: {",
					"    'vip-pass': {",
					"      description: 'Loaded from .bedrock dir.',",
					"      icon: { 'en-us': 'assets/vip-icon.png' },",
					"      name: 'Nested Pass',",
					"      price: 500,",
					"    },",
					"  },",
					"});",
				].join("\n"),
			);

			const result = await loadConfig({ cwd });

			assert(result.success);

			expect(result.data.passes!["vip-pass"]!.name).toBe("Nested Pass");
		});
	});

	it.skipIf(!HAS_LUTE)(
		"should discover bedrock.config.luau inside .bedrock/ when the project root has no config",
		async () => {
			expect.assertions(1);

			await withTemporaryDirectory(async (cwd) => {
				const bedrockDirectory = join(cwd, ".bedrock");
				mkdirSync(bedrockDirectory, { recursive: true });
				writeFileSync(
					join(bedrockDirectory, "bedrock.config.luau"),
					[
						"return {",
						"  environments = { production = {} },",
						"  passes = {",
						"    ['vip-pass'] = {",
						"      description = 'Loaded from .bedrock dir.',",
						"      icon = { ['en-us'] = 'assets/vip-icon.png' },",
						"      name = 'Nested Luau Pass',",
						"      price = 500,",
						"    },",
						"  },",
						"}",
						"",
					].join("\n"),
				);

				const result = await loadConfig({ cwd });

				assert(result.success);

				expect(result.data.passes!["vip-pass"]!.name).toBe("Nested Luau Pass");
			});
		},
	);

	it("should prefer the root bedrock.config.* over .bedrock/ when both exist", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			const bedrockDirectory = join(cwd, ".bedrock");
			mkdirSync(bedrockDirectory, { recursive: true });
			writeFixtureConfig(cwd, [
				"export default {",
				"  environments: { production: {} },",
				"  passes: {",
				"    'vip-pass': {",
				"      description: 'Root wins.',",
				"      icon: { 'en-us': 'assets/vip-icon.png' },",
				"      name: 'Root Pass',",
				"      price: 500,",
				"    },",
				"  },",
				"};",
			]);
			writeFileSync(
				join(bedrockDirectory, "bedrock.config.ts"),
				[
					"export default {",
					"  environments: { production: {} },",
					"  passes: {",
					"    'vip-pass': {",
					"      description: 'Nested loses.',",
					"      icon: { 'en-us': 'assets/vip-icon.png' },",
					"      name: 'Nested Pass',",
					"      price: 500,",
					"    },",
					"  },",
					"};",
				].join("\n"),
			);

			const result = await loadConfig({ cwd });

			assert(result.success);

			expect(result.data.passes!["vip-pass"]!.name).toBe("Root Pass");
		});
	});

	it("should attribute a parseFailed error to the .bedrock/ config file when that is the only source", async () => {
		expect.assertions(3);

		await withTemporaryDirectory(async (cwd) => {
			const bedrockDirectory = join(cwd, ".bedrock");
			mkdirSync(bedrockDirectory, { recursive: true });
			const malformedPath = join(bedrockDirectory, "bedrock.config.yaml");
			writeFileSync(
				malformedPath,
				["passes:", "  vip-pass:", '    name: "VIP Pass', "    price: 500", ""].join("\n"),
			);

			const result = await loadConfig({ cwd });

			assert(!result.success);
			assert(result.err.kind === "parseFailed");

			expect(result.err.kind).toBe("parseFailed");
			expect(result.err.sourceFile).toBe(malformedPath);
			expect(result.err.message.length).toBeGreaterThan(0);
		});
	});

	it("should return a fresh copy on each call so mutation does not leak between invocations", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			writeFixtureConfig(cwd, [
				"export default {",
				"  environments: { production: {} },",
				"  passes: {",
				"    'vip-pass': {",
				"      description: 'd',",
				"      icon: { 'en-us': 'p' },",
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

describe(bootstrapDirectoryPrefix, () => {
	it("should embed the supplied pid between the shared prefix and a trailing separator", () => {
		expect.assertions(1);

		expect(bootstrapDirectoryPrefix(12_345)).toBe("bedrock-luau-bootstrap-12345-");
	});

	it("should produce distinct prefixes for distinct process ids so parallel workers cannot collide", () => {
		expect.assertions(1);

		expect(bootstrapDirectoryPrefix(1)).not.toBe(bootstrapDirectoryPrefix(2));
	});
});
