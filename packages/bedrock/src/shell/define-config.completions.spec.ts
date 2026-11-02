import { createCompletionProbe } from "@bedrock-rbx/testing/completions";

import path from "node:path";
import { describe, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");

const PASS_FIELDS = ["retired", "name", "description", "icon", "price"];

/**
 * Wrap a `defineConfig` call in a module that imports it the way a user's
 * `bedrock.config.ts` does.
 *
 * @param call - The `defineConfig(...)` expression, containing the marker.
 * @returns Module text for the probe.
 */
function configModule(call: string): string {
	return `import { defineConfig } from "@bedrock-rbx/core/config";\nexport default ${call};\n`;
}

// Built once: loading the standard library dominates each probe.
const probe = createCompletionProbe({ projectDirectory: PACKAGE_ROOT });

describe("defineConfig completions", () => {
	it("should complete game-pass fields inside a root pass entry", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt(
			configModule(`defineConfig({
				environments: { production: {} },
				passes: { vip: { /*|*/ } },
			})`),
		);

		expect(names).toIncludeAllMembers(PASS_FIELDS);
	});

	it("should complete developer-product fields inside a root product entry", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt(
			configModule(`defineConfig({
				environments: { production: {} },
				products: { coins: { /*|*/ } },
			})`),
		);

		expect(names).toIncludeAllMembers(["retired", "name", "description", "price"]);
	});

	it("should complete place fields inside a root place entry", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt(
			configModule(`defineConfig({
				environments: { production: {} },
				places: { start: { /*|*/ } },
			})`),
		);

		expect(names).toIncludeAllMembers(["retired", "filePath", "serverSize"]);
	});

	it("should complete game-pass fields inside an environment overlay entry", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt(
			configModule(`defineConfig({
				environments: { production: { passes: { vip: { /*|*/ } } } },
				passes: {
					vip: {
						name: "VIP",
						description: "VIP perks.",
						icon: { "en-us": "assets/vip.png" },
					},
				},
			})`),
		);

		expect(names).toIncludeAllMembers(["retired", "name", "price"]);
	});

	it("should complete game-pass fields when the config is returned from a function", ({
		expect,
	}) => {
		expect.assertions(1);

		const names = probe.completionsAt(
			configModule(`defineConfig(() => ({
				environments: { production: {} },
				passes: { vip: { /*|*/ } },
			}))`),
		);

		expect(names).toIncludeAllMembers(PASS_FIELDS);
	});

	it("should complete game-pass fields when the config is returned from an async function", ({
		expect,
	}) => {
		expect.assertions(1);

		const names = probe.completionsAt(
			configModule(`defineConfig(async () => ({
				environments: { production: {} },
				passes: { vip: { /*|*/ } },
			}))`),
		);

		expect(names).toIncludeAllMembers(PASS_FIELDS);
	});
});
