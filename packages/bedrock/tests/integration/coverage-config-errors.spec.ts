import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "vitest";

import { loadConfig } from "../../src/index.ts";
import { loadConfigWith } from "../../src/shell/load-config.ts";

describe("config resolver diagnostics", () => {
	it("should load an absolute Luau base through the evaluator port", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const cwd = mkdtempSync(join(tmpdir(), "bedrock-config-absolute-base-"));
		onTestFinished(() => {
			rmSync(cwd, { force: true, recursive: true });
		});
		const base = join(cwd, "base.luau");
		writeFileSync(base, "return {}");
		writeFileSync(
			join(cwd, "bedrock.config.json"),
			JSON.stringify({ environments: { production: {} }, extends: base }),
		);
		const result = await loadConfigWith(
			{
				evaluator: async () => {
					return {
						data: {
							passes: {
								vip: {
									name: "VIP Pass",
									description: "VIP access",
									icon: { "en-us": "vip.png" },
								},
							},
						},
						success: true,
					};
				},
				importModule: async () => {
					throw new Error("config declares no plugins");
				},
			},
			{ cwd },
		);
		assert(result.success, JSON.stringify(result));

		expect(result.data.passes!["vip"]!.name).toBe("VIP Pass");
	});

	it("should allow an absent optional Luau base without evaluating it", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const cwd = mkdtempSync(join(tmpdir(), "bedrock-config-missing-base-"));
		onTestFinished(() => {
			rmSync(cwd, { force: true, recursive: true });
		});
		writeFileSync(
			join(cwd, "bedrock.config.json"),
			JSON.stringify({ environments: { production: {} }, extends: "./missing.luau" }),
		);
		const result = await loadConfigWith(
			{
				evaluator: async () => {
					throw new Error("missing base must fall through to c12");
				},
				importModule: async () => {
					throw new Error("config declares no plugins");
				},
			},
			{ cwd },
		);
		assert(result.success);

		expect(result.data.environments).toStrictEqual({ production: {} });
	});

	it("should attribute an error without stack frames in an explicitly named config to its search directory", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const cwd = mkdtempSync(join(tmpdir(), "bedrock-config-no-stack-"));
		onTestFinished(() => {
			rmSync(cwd, { force: true, recursive: true });
		});
		writeFileSync(
			join(cwd, "custom.config.mjs"),
			"export default () => { const error = new Error('config unavailable'); error.stack = undefined; throw error; };",
		);
		const result = await loadConfig({ configFile: "custom.config.mjs", cwd });

		expect(result).toStrictEqual({
			err: { kind: "parseFailed", message: "config unavailable", sourceFile: cwd },
			success: false,
		});
	});

	it("should retain file attribution for a user error whose stack contains only unrelated frames", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const cwd = mkdtempSync(join(tmpdir(), "bedrock-config-foreign-stack-"));
		onTestFinished(() => {
			rmSync(cwd, { force: true, recursive: true });
		});
		writeFileSync(
			join(cwd, "bedrock.config.mjs"),
			"export default () => { const error = new Error('remote settings unavailable'); error.stack = 'Error: remote settings unavailable\\n    at readSettings (settings.mjs:1:1)'; throw error; };",
		);
		const result = await loadConfig({ cwd });

		expect(result).toStrictEqual({
			err: {
				kind: "parseFailed",
				message: "remote settings unavailable",
				sourceFile: join(cwd, "bedrock.config.mjs"),
			},
			success: false,
		});
	});
});
