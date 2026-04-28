import { parseYAML } from "confbox";
import { describe, expect, it } from "vitest";

import type { Config } from "../schema.ts";
import { serializeConfig, type SerializeConfigOptions } from "./serialize-config.ts";

const SINGLE_ENV_UNIVERSE_CONFIG: Config = {
	environments: { production: {} },
	universe: { universeId: "1234567890" },
};

function makeOptions(overrides?: Partial<SerializeConfigOptions>): SerializeConfigOptions {
	return {
		config: SINGLE_ENV_UNIVERSE_CONFIG,
		configFormat: "typescript",
		...overrides,
	};
}

describe(serializeConfig, () => {
	describe("typescript output", () => {
		it("should place the @bedrock/core defineConfig import at the top of the file", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(source.startsWith('import { defineConfig } from "@bedrock/core";\n')).toBeTrue();
		});

		it("should wrap the config body in defineConfig and export it as default", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(source).toContain("export default defineConfig({");
		});

		it("should embed the universe.universeId verbatim in the rendered source", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(source).toContain('"universeId": "1234567890"');
		});

		it("should render the environment names declared in the config", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(source).toContain('"production": {}');
		});

		it("should round-trip the body back into the same Config when parsed as JSON", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());
			const body = source.slice(
				source.indexOf("defineConfig(") + "defineConfig(".length,
				source.lastIndexOf(")"),
			);

			expect(JSON.parse(body)).toStrictEqual(SINGLE_ENV_UNIVERSE_CONFIG);
		});

		it("should end with a trailing newline so editors do not complain", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(source.endsWith("\n")).toBeTrue();
		});

		it("should match the snapshot for a single-environment universe config", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(source).toMatchInlineSnapshot(`
				"import { defineConfig } from "@bedrock/core";

				export default defineConfig({
				  "environments": {
				    "production": {}
				  },
				  "universe": {
				    "universeId": "1234567890"
				  }
				});
				"
			`);
		});
	});

	describe("yaml output", () => {
		it("should embed the universe.universeId verbatim in the rendered source", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions({ configFormat: "yaml" }));

			expect(source).toContain("universeId: '1234567890'");
		});

		it("should render the environment names declared in the config", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions({ configFormat: "yaml" }));

			expect(source).toContain("production:");
		});

		it("should round-trip back into the same Config when parsed as YAML", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions({ configFormat: "yaml" }));

			expect(parseYAML(source)).toStrictEqual(SINGLE_ENV_UNIVERSE_CONFIG);
		});

		it("should end with a trailing newline so editors do not complain", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions({ configFormat: "yaml" }));

			expect(source.endsWith("\n")).toBeTrue();
		});

		it("should omit keys whose value is undefined rather than emit null or tilde", () => {
			expect.assertions(3);

			const configWithUndefinedFields: Config = {
				environments: { production: {} },
				universe: {
					consoleEnabled: undefined,
					desktopEnabled: undefined,
					universeId: "1234567890",
				},
			};

			const source = serializeConfig(
				makeOptions({ config: configWithUndefinedFields, configFormat: "yaml" }),
			);

			expect(source).not.toContain("null");
			expect(source).not.toMatch(/:\s*~/);
			expect(source).not.toContain("consoleEnabled");
		});

		it("should match the snapshot for a single-environment universe config", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions({ configFormat: "yaml" }));

			expect(source).toMatchInlineSnapshot(`
				"environments:
				  production: {}
				universe:
				  universeId: '1234567890'
				"
			`);
		});
	});
});
