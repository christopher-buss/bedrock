import { assert, describe, expect, it } from "vitest";

import { migrateMantleState } from "./migrate-mantle-state.ts";

const SINGLE_ENV_YAML = `
version: "6"
environments:
  production:
    - id: experience_singleton
      inputs:
        experience:
          groupId: ~
      outputs:
        experience:
          assetId: 6031475575
          startPlaceId: 17613681043
      dependencies: []
`;

const TWO_ENV_YAML = `
version: "6"
environments:
  development:
    - id: experience_singleton
      inputs:
        experience:
          groupId: ~
      outputs:
        experience:
          assetId: 1111111111
          startPlaceId: 2222222222
      dependencies: []
  production:
    - id: experience_singleton
      inputs:
        experience:
          groupId: ~
      outputs:
        experience:
          assetId: 6031475575
          startPlaceId: 17613681043
      dependencies: []
`;

function fakeReadFile(content: string): (path: string) => Promise<Uint8Array> {
	return async () => new TextEncoder().encode(content);
}

async function readFileMissing(): Promise<Uint8Array> {
	throw Object.assign(new Error("not found"), { code: "ENOENT" });
}

describe(migrateMantleState, () => {
	it("should return stateFileNotFound when readFile reports the file is missing", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: readFileMissing,
			stateFilePath: "/tmp/missing.mantle-state.yml",
		});

		assert(!result.success);
		assert(result.err.kind === "stateFileNotFound");

		expect(result.err.kind).toBe("stateFileNotFound");
		expect(result.err.path).toBe("/tmp/missing.mantle-state.yml");
	});

	it("should propagate stateParseFailed when the YAML is malformed", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile(":\nthis is: : invalid yaml ::"),
			stateFilePath: ".mantle-state.yml",
		});

		assert(!result.success);
		assert(result.err.kind === "stateParseFailed");

		expect(result.err.kind).toBe("stateParseFailed");
		expect(result.err.path).toBe(".mantle-state.yml");
	});

	it("should propagate unsupportedMantleStateVersion when the input is not v6", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile('version: "5"\nenvironments:\n  production: []\n'),
			stateFilePath: ".mantle-state.yml",
		});

		assert(!result.success);
		assert(result.err.kind === "unsupportedMantleStateVersion");

		expect(result.err.kind).toBe("unsupportedMantleStateVersion");
		expect(result.err.found).toBe("5");
	});

	it("should produce a placeholder report whose config declares each environment", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(Object.keys(result.data.config.environments)).toStrictEqual(["production"]);
		expect(result.data.config.environments["production"]).toStrictEqual({});
	});

	it("should produce a BedrockState carrying the folded universe resource per environment", async () => {
		expect.assertions(4);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		const state = result.data.statesByEnvironment["production"];
		assert(state !== undefined);

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(state.environment).toBe("production");
		expect(state.version).toBe(1);
		expect(resource.universeId).toBe("6031475575");
		expect(resource.outputs.rootPlaceId).toBe("17613681043");
	});

	it("should emit zero warnings and a zeroed summary in the skeleton", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.warnings).toStrictEqual([]);
		expect(result.data.summary).toStrictEqual({
			ambiguousCount: 0,
			blockedCount: 0,
			deferredCount: 0,
			interpretiveCount: 0,
		});
	});

	it("should serialize the folded config as a defineConfig TypeScript module", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.configFileContent).toContain(
			'import { defineConfig } from "@bedrock/core"',
		);
		expect(result.data.configFileContent).toContain("export default defineConfig({");
		expect(result.data.configFileContent).toContain('"universeId": "6031475575"');
	});

	it("should expose universe.universeId on the resolved Config", async () => {
		expect.assertions(1);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.config.universe?.universeId).toBe("6031475575");
	});

	it("should return primaryEnvironmentRequired with an empty available list when no environments are declared", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile('version: "6"\nenvironments: {}\n'),
			stateFilePath: ".mantle-state.yml",
		});

		assert(!result.success);
		assert(result.err.kind === "primaryEnvironmentRequired");

		expect(result.err.kind).toBe("primaryEnvironmentRequired");
		expect(result.err.available).toStrictEqual([]);
	});

	it("should require primaryEnvironment when the input declares more than one environment", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile(TWO_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(!result.success);
		assert(result.err.kind === "primaryEnvironmentRequired");

		expect(result.err.kind).toBe("primaryEnvironmentRequired");
		expect(result.err.available).toStrictEqual(["development", "production"]);
	});

	it("should reject a primaryEnvironment that is not present in the input", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			primaryEnvironment: "staging",
			readFile: fakeReadFile(TWO_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(!result.success);
		assert(result.err.kind === "primaryEnvironmentNotFound");

		expect(result.err.kind).toBe("primaryEnvironmentNotFound");
		expect(result.err.requested).toBe("staging");
		expect(result.err.available).toStrictEqual(["development", "production"]);
	});

	it("should seed the root config from the explicitly chosen primary environment", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			primaryEnvironment: "development",
			readFile: fakeReadFile(TWO_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.config.universe?.universeId).toBe("1111111111");
		expect(Object.keys(result.data.statesByEnvironment)).toStrictEqual([
			"development",
			"production",
		]);
	});

	it("should keep each environment's BedrockState truthful to its own deployed values", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			primaryEnvironment: "production",
			readFile: fakeReadFile(TWO_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		const { development, production } = result.data.statesByEnvironment;
		assert(development !== undefined && production !== undefined);

		const [developmentUniverse] = development.resources;
		const [productionUniverse] = production.resources;
		assert(developmentUniverse?.kind === "universe" && productionUniverse?.kind === "universe");

		expect(developmentUniverse.universeId).toBe("1111111111");
		expect(productionUniverse.universeId).toBe("6031475575");
	});

	it("should surface internalError when validateConfig rejects a migrator-emitted config", async () => {
		expect.assertions(3);

		const yamlWithInvalidEnvironmentName = `
version: "6"
environments:
  "has spaces":
    - id: experience_singleton
      inputs:
        experience: {}
      outputs:
        experience:
          assetId: 1
          startPlaceId: 2
      dependencies: []
`;

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile(yamlWithInvalidEnvironmentName),
			stateFilePath: ".mantle-state.yml",
		});

		assert(!result.success);
		assert(result.err.kind === "internalError");
		assert(result.err.cause.kind === "validationFailed");

		expect(result.err.cause.kind).toBe("validationFailed");
		expect(result.err.cause.sourceFile).toBe("<migrate-mantle-state>");
		expect(result.err.reason).toBe("migrator emitted a config that failed validateConfig");
	});

	it("should re-throw a non-missing-file readFile error so callers see permission failures", async () => {
		expect.assertions(1);

		const denied = Object.assign(new Error("denied"), { code: "EPERM" });
		const promise = migrateMantleState({
			outputFormat: "typescript",
			readFile: async () => {
				throw denied;
			},
			stateFilePath: "/etc/locked.mantle-state.yml",
		});

		await expect(promise).rejects.toThrow("denied");
	});

	it("should re-throw a non-object readFile rejection rather than treat it as a missing file", async () => {
		expect.assertions(1);

		const promise = migrateMantleState({
			outputFormat: "typescript",
			readFile: async () => {
				// eslint-disable-next-line ts/only-throw-error -- testing the non-object branch of isFileMissing
				throw "string-shaped failure";
			},
			stateFilePath: "/tmp/.mantle-state.yml",
		});

		await expect(promise).rejects.toBe("string-shaped failure");
	});

	it("should re-throw a null readFile rejection rather than treat it as a missing file", async () => {
		expect.assertions(1);

		const promise = migrateMantleState({
			outputFormat: "typescript",
			readFile: async () => {
				// eslint-disable-next-line unicorn/no-null, ts/only-throw-error -- testing the null branch of isFileMissing
				throw null;
			},
			stateFilePath: "/tmp/.mantle-state.yml",
		});

		await expect(promise).rejects.toBeNull();
	});

	it("should re-throw a readFile rejection whose object lacks a code property", async () => {
		expect.assertions(1);

		const bare = new Error("bare error without code");
		const promise = migrateMantleState({
			outputFormat: "typescript",
			readFile: async () => {
				throw bare;
			},
			stateFilePath: "/tmp/.mantle-state.yml",
		});

		await expect(promise).rejects.toBe(bare);
	});

	it("should re-throw a readFile rejection whose code is not a string", async () => {
		expect.assertions(1);

		const numeric = Object.assign(new Error("numeric code"), { code: 42 });
		const promise = migrateMantleState({
			outputFormat: "typescript",
			readFile: async () => {
				throw numeric;
			},
			stateFilePath: "/tmp/.mantle-state.yml",
		});

		await expect(promise).rejects.toBe(numeric);
	});
});
