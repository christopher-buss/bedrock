import { describe, expect, it } from "vitest";

import type { CodegenFile } from "./codegen.ts";
import { buildCodegenEnvironments, hashCodegenFiles, isCodegenEnabled } from "./codegen.ts";
import type { CodegenConfig } from "./schema.ts";
import type { BedrockState } from "./state.ts";

const PRODUCTION: BedrockState = { environment: "production", resources: [], version: 1 };

const fileA: CodegenFile = { content: "return { a = 1 }\n", path: "a.luau" };
const fileB: CodegenFile = { content: "return { b = 2 }\n", path: "b.luau" };

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

describe(hashCodegenFiles, () => {
	it("should return a 64-character lowercase hex digest", async () => {
		expect.assertions(1);

		const hash = await hashCodegenFiles([fileA]);

		expect(hash).toMatch(/^[0-9a-f]{64}$/u);
	});

	it("should produce the same hash regardless of emitted file order", async () => {
		expect.assertions(1);

		const forward = await hashCodegenFiles([fileA, fileB]);
		const reversed = await hashCodegenFiles([fileB, fileA]);

		expect(reversed).toBe(forward);
	});

	it("should produce a different hash when file content changes", async () => {
		expect.assertions(1);

		const before = await hashCodegenFiles([fileA]);
		const after = await hashCodegenFiles([{ content: "return { a = 2 }\n", path: "a.luau" }]);

		expect(after).not.toBe(before);
	});

	it("should produce a different hash when a file path changes", async () => {
		expect.assertions(1);

		const before = await hashCodegenFiles([fileA]);
		const after = await hashCodegenFiles([{ content: fileA.content, path: "renamed.luau" }]);

		expect(after).not.toBe(before);
	});

	it("should distinguish a path/content boundary shift between two files", async () => {
		expect.assertions(1);

		const split = await hashCodegenFiles([
			{ content: "y", path: "x" },
			{ content: "", path: "z" },
		]);
		const shifted = await hashCodegenFiles([
			{ content: "", path: "xy" },
			{ content: "", path: "z" },
		]);

		expect(shifted).not.toBe(split);
	});
});
