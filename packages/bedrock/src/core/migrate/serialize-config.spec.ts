import { parseYAML } from "confbox";
import { parseJSON5 } from "confbox/json5";
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
		it("should place the @bedrock/core/config defineConfig import at the top of the file", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(
				source.startsWith('import { defineConfig } from "@bedrock/core/config";\n'),
			).toBeTrue();
		});

		it("should wrap the config body in defineConfig and export it as default", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(source).toContain("export default defineConfig({");
		});

		it("should embed the universe.universeId verbatim in the rendered source", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(source).toContain('universeId: "1234567890"');
		});

		it("should render the environment names declared in the config", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());

			expect(source).toContain("production: {}");
		});

		it("should indent the rendered body with tabs", () => {
			expect.assertions(2);

			const source = serializeConfig(makeOptions());

			expect(source).toContain("\n\tenvironments");
			expect(source).not.toContain("\n  environments");
		});

		it("should leave identifier-style keys unquoted", () => {
			expect.assertions(2);

			const source = serializeConfig(makeOptions());

			expect(source).toContain("environments:");
			expect(source).not.toContain('"environments":');
		});

		it("should quote keys that are not valid identifiers", () => {
			expect.assertions(2);

			const config: Config = {
				environments: { "feature-branch": {}, "production": {} },
				universe: { universeId: "1234567890" },
			};

			const source = serializeConfig(makeOptions({ config }));

			expect(source).toContain('"feature-branch":');
			expect(source).not.toContain("feature-branch:");
		});

		it("should keep string values double-quoted", () => {
			expect.assertions(2);

			const source = serializeConfig(makeOptions());

			expect(source).toContain('"1234567890"');
			expect(source).not.toContain("'1234567890'");
		});

		it("should render boolean values as bare literals without quotes", () => {
			expect.assertions(2);

			const config: Config = {
				environments: { production: {} },
				universe: {
					consoleEnabled: true,
					universeId: "1234567890",
				},
			};

			const source = serializeConfig(makeOptions({ config }));

			expect(source).toContain("consoleEnabled: true");
			expect(source).not.toContain('consoleEnabled: "true"');
		});

		it("should omit keys whose value is undefined rather than emit them", () => {
			expect.assertions(2);

			const config: Config = {
				environments: { production: {} },
				universe: {
					consoleEnabled: undefined,
					universeId: "1234567890",
				},
			};

			const source = serializeConfig(makeOptions({ config }));

			expect(source).not.toContain("consoleEnabled");
			expect(source).not.toContain("undefined");
		});

		it("should round-trip the body back into the same Config when parsed as JSON5", () => {
			expect.assertions(1);

			const source = serializeConfig(makeOptions());
			const body = source.slice(
				source.indexOf("defineConfig(") + "defineConfig(".length,
				source.lastIndexOf(")"),
			);

			expect(parseJSON5(body)).toStrictEqual(SINGLE_ENV_UNIVERSE_CONFIG);
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
			  "import { defineConfig } from "@bedrock/core/config";

			  export default defineConfig({
			  	environments: {
			  		production: {}
			  	},
			  	universe: {
			  		universeId: "1234567890"
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
