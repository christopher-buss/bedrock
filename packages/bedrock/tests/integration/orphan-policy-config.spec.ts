import { loadConfig, selectEnvironment, validateConfig } from "@bedrock-rbx/core";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "vitest";

describe("orphan policy config", () => {
	it.for(["error", "retire"] as const)(
		"should load %s through every config format",
		async (policy, { expect, onTestFinished }) => {
			expect.hasAssertions();

			const formats: Record<string, string> = {
				js: `export default { environments: { production: {} }, orphans: "${policy}" };`,
				json: JSON.stringify({ environments: { production: {} }, orphans: policy }),
				luau: `return { environments = { production = {} }, orphans = "${policy}" }`,
				ts: `export default { environments: { production: {} }, orphans: "${policy}" };`,
				yaml: `environments:\n  production: {}\norphans: ${policy}\n`,
			};
			const loadedPolicies: Array<unknown> = [];
			for (const [format, contents] of Object.entries(formats)) {
				const cwd = await mkdtemp(join(tmpdir(), "bedrock-orphan-policy-"));
				onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
				await writeFile(join(cwd, `bedrock.config.${format}`), contents);
				const loaded = await loadConfig({ cwd });
				assert(loaded.success, JSON.stringify(loaded));

				expect(loaded.data.orphans).toBe(policy);

				const selected = selectEnvironment(loaded.data, "production");
				assert(selected.success);

				expect(selected.data.orphans).toBe(policy);

				loadedPolicies.push(selected.data.orphans);
			}

			expect(loadedPolicies).toStrictEqual([policy, policy, policy, policy, policy]);
		},
	);

	it.for(["delete", "RETIRE", "", true, false, 0, JSON.parse("null"), {}, []])(
		"should reject invalid policy %j",
		(orphans, { expect }) => {
			expect.assertions(1);
			expect(
				validateConfig(
					{ environments: { production: {} }, orphans },
					"bedrock.config.json",
				),
			).toMatchObject({
				err: {
					issues: [expect.objectContaining({ path: ["orphans"] })],
					kind: "validationFailed",
				},
				success: false,
			});
		},
	);

	it("should keep orphan policy exclusive to the project root", ({ expect }) => {
		expect.assertions(1);
		expect(
			validateConfig(
				{ environments: { production: { orphans: "retire" } } },
				"bedrock.config.json",
			),
		).toMatchObject({ success: false });
	});
});
