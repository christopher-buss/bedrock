import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import { fileURLToPath } from "node:url";
import { assert, describe, it } from "vitest";

import { buildDesired, flattenConfig, loadConfig, selectEnvironment } from "#src/index";

const formats = HAS_LUTE
	? ["json", "yaml", "javascript", "typescript", "luau"]
	: ["json", "yaml", "javascript", "typescript"];
const environments = [
	{
		environment: "production",
		expected: [
			{ kind: "developerProduct", movedFrom: "env-gems" },
			{ kind: "gamePass", movedFrom: "env-vip" },
			{ kind: "place", movedFrom: "env-lobby" },
			{ kind: "universe", movedFrom: "env-world" },
		],
	},
	{
		environment: "staging",
		expected: [
			{ kind: "developerProduct", movedFrom: "old-gems" },
			{ kind: "gamePass", movedFrom: "old-vip" },
			{ kind: "place", movedFrom: "old-lobby" },
			{ kind: "universe", movedFrom: "old-world" },
		],
	},
];
const cases = formats.flatMap((format) => {
	return environments.map((environment) => ({ format, ...environment }));
});

describe("rename declarations across config formats", () => {
	it.for(cases)(
		"should preserve every kind's movedFrom in $format for $environment",
		async ({ environment, expected, format }, { expect }) => {
			expect.assertions(1);

			const loaded = await loadConfig({
				cwd: fileURLToPath(new URL(`fixtures/renames/${format}`, import.meta.url)),
			});
			assert(loaded.success);
			const selected = selectEnvironment(loaded.data, environment);
			assert(selected.success);
			const desired = await buildDesired({
				async readFile() {
					return new Uint8Array();
				},
				resources: flattenConfig(selected.data),
			});
			assert(desired.success);

			expect(desired.data.map((entry) => {
				assert(!("retired" in entry));
				return { kind: entry.kind, movedFrom: entry.movedFrom };
			})).toStrictEqual(
				expected,
			);
		},
	);
});
