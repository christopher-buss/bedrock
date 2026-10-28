import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import { fileURLToPath } from "node:url";
import { assert, describe, it } from "vitest";

import { buildDesired, flattenConfig, loadConfig, selectEnvironment } from "#src/index";

const formats = HAS_LUTE
	? ["json", "yaml", "javascript", "typescript", "luau"]
	: ["json", "yaml", "javascript", "typescript"];
const expected = [
	{ kind: "developerProduct", movedFrom: "old-gems" },
	{ kind: "gamePass", movedFrom: "old-vip" },
	{ kind: "place", movedFrom: "old-lobby" },
	{ kind: "universe" },
];

describe("rename declarations across config formats", () => {
	it.for(formats)(
		"should preserve root movedFrom on every kind that supports it in %s",
		async (format, { expect }) => {
			expect.assertions(2);

			const loaded = await loadConfig({
				cwd: fileURLToPath(new URL(`fixtures/renames/${format}`, import.meta.url)),
			});
			assert(loaded.success);
			const selected = selectEnvironment(loaded.data, "production");
			assert(selected.success);
			const desired = await buildDesired({
				async readFile() {
					return new Uint8Array();
				},
				resources: flattenConfig(selected.data),
			});
			assert(desired.success);

			expect(desired.data).toMatchObject(expected);
			expect(desired.data[3]).not.toHaveProperty("movedFrom");
		},
	);

	it.for(formats)(
		"should reject movedFrom on the universe and on environment overlays in %s",
		async (format, { expect }) => {
			expect.assertions(1);

			const loaded = await loadConfig({
				cwd: fileURLToPath(new URL(`fixtures/rejected-renames/${format}`, import.meta.url)),
			});

			assert(!loaded.success && loaded.err.kind === "validationFailed");

			expect(loaded.err.issues.map((issue) => issue.path.join(".")).toSorted()).toStrictEqual(
				[
					"environments.production.passes.vip.movedFrom",
					"environments.production.places.lobby.movedFrom",
					"environments.production.products.gems.movedFrom",
					"environments.production.universe.movedFrom",
					"universe.movedFrom",
				],
			);
		},
	);
});
