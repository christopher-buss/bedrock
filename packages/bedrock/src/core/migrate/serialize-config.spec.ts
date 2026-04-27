import { describe, expect, it } from "vitest";

import type { Config } from "../schema.ts";
import { serializeConfig } from "./serialize-config.ts";

const SINGLE_ENV_UNIVERSE_CONFIG: Config = {
	environments: { production: {} },
	universe: { universeId: "1234567890" },
};

describe(serializeConfig, () => {
	it("should begin with the @bedrock/core defineConfig import", () => {
		expect.assertions(1);

		const source = serializeConfig(SINGLE_ENV_UNIVERSE_CONFIG);

		expect(source.startsWith('import { defineConfig } from "@bedrock/core";\n')).toBeTrue();
	});

	it("should wrap the config body in defineConfig and export it as default", () => {
		expect.assertions(1);

		const source = serializeConfig(SINGLE_ENV_UNIVERSE_CONFIG);

		expect(source).toContain("export default defineConfig({");
	});

	it("should embed the universe.universeId verbatim in the rendered source", () => {
		expect.assertions(1);

		const source = serializeConfig(SINGLE_ENV_UNIVERSE_CONFIG);

		expect(source).toContain('"universeId": "1234567890"');
	});

	it("should render the environment names declared in the config", () => {
		expect.assertions(1);

		const source = serializeConfig(SINGLE_ENV_UNIVERSE_CONFIG);

		expect(source).toContain('"production": {}');
	});

	it("should round-trip back into the same Config when parsed as JSON", () => {
		expect.assertions(1);

		const source = serializeConfig(SINGLE_ENV_UNIVERSE_CONFIG);
		const body = source.slice(
			source.indexOf("defineConfig(") + "defineConfig(".length,
			source.lastIndexOf(")"),
		);

		expect(JSON.parse(body)).toStrictEqual(SINGLE_ENV_UNIVERSE_CONFIG);
	});

	it("should end with a trailing newline so editors do not complain", () => {
		expect.assertions(1);

		const source = serializeConfig(SINGLE_ENV_UNIVERSE_CONFIG);

		expect(source.endsWith("\n")).toBeTrue();
	});
});
