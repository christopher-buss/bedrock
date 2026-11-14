import { loadConfig, validateConfig } from "@bedrock-rbx/core";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "vitest";

describe("spendLimit config", () => {
	it.for([
		{
			contents: "export default { environments: { production: { spendLimit: 500 } } };",
			format: "ts",
		},
		{ contents: '{"environments":{"production":{"spendLimit":500}}}', format: "json" },
		{ contents: "environments:\n  production:\n    spendLimit: 500\n", format: "yaml" },
		{
			contents: "return { environments = { production = { spendLimit = 500 } } }",
			format: "luau",
		},
	])(
		"should load the limit on an Environment overlay in $format configs",
		async ({ contents, format }, { expect, onTestFinished }) => {
			expect.assertions(1);

			const cwd = await mkdtemp(join(tmpdir(), "bedrock-spend-limit-"));
			onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
			await writeFile(join(cwd, `bedrock.config.${format}`), contents);
			const loaded = await loadConfig({ cwd });
			assert(loaded.success, JSON.stringify(loaded));

			expect(loaded.data.environments["production"]!.spendLimit).toBe(500);
		},
	);

	it("should accept a limit of 0", ({ expect }) => {
		expect.assertions(1);
		expect(
			validateConfig(
				{ environments: { production: { spendLimit: 0 } } },
				"bedrock.config.json",
			),
		).toMatchObject({ success: true });
	});

	it("should reject the limit at the root", ({ expect }) => {
		expect.assertions(1);
		expect(
			validateConfig(
				{ environments: { production: {} }, spendLimit: 500 },
				"bedrock.config.json",
			),
		).toMatchObject({ err: { kind: "validationFailed" }, success: false });
	});

	it.for([-1, 1.5, Infinity, "500"])("should reject a limit of %s", (spendLimit, { expect }) => {
		expect.assertions(1);
		expect(
			validateConfig({ environments: { production: { spendLimit } } }, "bedrock.config.json"),
		).toMatchObject({
			err: {
				issues: [
					expect.objectContaining({
						path: ["environments", "production", "spendLimit"],
					}),
				],
				kind: "validationFailed",
			},
			success: false,
		});
	});
});
