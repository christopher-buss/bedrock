import { loadConfig, validateConfig } from "@bedrock-rbx/core";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "vitest";

describe("allowDeferredCreates config", () => {
	it.for([
		{
			contents: "export default { environments: { dev: { allowDeferredCreates: true } } };",
			format: "ts",
		},
		{ contents: '{"environments":{"dev":{"allowDeferredCreates":true}}}', format: "json" },
		{ contents: "environments:\n  dev:\n    allowDeferredCreates: true\n", format: "yaml" },
		{
			contents: "return { environments = { dev = { allowDeferredCreates = true } } }",
			format: "luau",
		},
	])(
		"should load the setting on an Environment overlay in $format configs",
		async ({ contents, format }, { expect, onTestFinished }) => {
			expect.assertions(1);

			const cwd = await mkdtemp(join(tmpdir(), "bedrock-deferred-creates-"));
			onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
			await writeFile(join(cwd, `bedrock.config.${format}`), contents);
			const loaded = await loadConfig({ cwd });
			assert(loaded.success, JSON.stringify(loaded));

			expect(loaded.data.environments["dev"]!.allowDeferredCreates).toBeTrue();
		},
	);

	it("should reject the setting at the root", ({ expect }) => {
		expect.assertions(1);
		expect(
			validateConfig(
				{ allowDeferredCreates: true, environments: { dev: {} } },
				"bedrock.config.json",
			),
		).toMatchObject({ err: { kind: "validationFailed" }, success: false });
	});

	it("should reject a non-boolean setting", ({ expect }) => {
		expect.assertions(1);
		expect(
			validateConfig(
				{ environments: { dev: { allowDeferredCreates: "yes" } } },
				"bedrock.config.json",
			),
		).toMatchObject({
			err: {
				issues: [
					expect.objectContaining({
						path: ["environments", "dev", "allowDeferredCreates"],
					}),
				],
				kind: "validationFailed",
			},
			success: false,
		});
	});
});
