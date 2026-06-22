import { describe, expect, it } from "vitest";

import { buildCodegenEnvironments, isCodegenEnabled } from "./codegen.ts";
import type { CodegenConfig } from "./schema.ts";
import type { BedrockState } from "./state.ts";

const PRODUCTION: BedrockState = { environment: "production", resources: [], version: 1 };

describe(buildCodegenEnvironments, () => {
	it("should return each supplied environment state unchanged under its name", () => {
		expect.assertions(1);

		const result = buildCodegenEnvironments({ production: PRODUCTION });

		expect(result["production"]).toBe(PRODUCTION);
	});

	it("should normalize a never-deployed environment to an empty state carrying its name", () => {
		expect.assertions(1);

		const result = buildCodegenEnvironments({ staging: undefined });

		expect(result["staging"]).toStrictEqual({
			environment: "staging",
			resources: [],
			version: 1,
		});
	});

	it("should assemble every declared environment into the resulting map", () => {
		expect.assertions(3);

		const result = buildCodegenEnvironments({
			production: PRODUCTION,
			staging: undefined,
		});

		expect(result).toContainKeys(["production", "staging"]);
		expect(result["production"]).toBe(PRODUCTION);
		expect(result["staging"]!.resources).toBeEmpty();
	});
});

describe(isCodegenEnabled, () => {
	it("should report enabled when the codegen flag is explicitly true", () => {
		expect.assertions(1);

		expect(isCodegenEnabled({ enabled: true, output: "src/generated" })).toBeTrue();
	});

	it("should report disabled when the codegen flag is explicitly false", () => {
		expect.assertions(1);

		expect(isCodegenEnabled({ enabled: false })).toBeFalse();
	});

	it("should report disabled when the codegen section omits the flag", () => {
		expect.assertions(1);

		const codegen: CodegenConfig = {};

		expect(isCodegenEnabled(codegen)).toBeFalse();
	});

	it("should report disabled when no codegen section is configured", () => {
		expect.assertions(1);

		expect(isCodegenEnabled(undefined)).toBeFalse();
	});
});
