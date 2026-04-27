import { assert, describe, expect, it } from "vitest";

import manifest from "../../package.json" with { type: "json" };
import { migrateMantleState } from "./migrate-mantle-state.ts";

const VALID_HASH = "908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9";
const PROD_HASH = "804a980a447b7fb258cb2d64b8e3e4bbf323ea76b203510457a14cfd536c1970";

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

const SINGLE_ENV_WITH_PLACE_YAML = `
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
    - id: place_start
      inputs:
        place:
          isStart: true
      outputs:
        place:
          assetId: 17613681043
      dependencies:
        - experience_singleton
    - id: placeFile_start
      inputs:
        placeFile:
          filePath: place.rbxl
          fileHash: ${VALID_HASH}
      outputs:
        placeFile:
          version: 53
      dependencies:
        - place_start
        - experience_singleton
`;

const TWO_ENV_PLACE_YAML = `
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
    - id: place_start
      inputs:
        place:
          isStart: true
      outputs:
        place:
          assetId: 2222222222
      dependencies: []
    - id: placeFile_start
      inputs:
        placeFile:
          filePath: place.rbxl
          fileHash: ${VALID_HASH}
      outputs:
        placeFile:
          version: 7
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
    - id: place_start
      inputs:
        place:
          isStart: true
      outputs:
        place:
          assetId: 17613681043
      dependencies: []
    - id: placeFile_start
      inputs:
        placeFile:
          filePath: place.rbxlx
          fileHash: ${PROD_HASH}
      outputs:
        placeFile:
          version: 12
      dependencies: []
`;

const TWO_ENV_PLACE_SAME_PATH_YAML = `
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
    - id: place_start
      inputs:
        place:
          isStart: true
      outputs:
        place:
          assetId: 2222222222
      dependencies: []
    - id: placeFile_start
      inputs:
        placeFile:
          filePath: place.rbxl
          fileHash: ${VALID_HASH}
      outputs:
        placeFile:
          version: 7
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
    - id: place_start
      inputs:
        place:
          isStart: true
      outputs:
        place:
          assetId: 17613681043
      dependencies: []
    - id: placeFile_start
      inputs:
        placeFile:
          filePath: place.rbxl
          fileHash: ${VALID_HASH}
      outputs:
        placeFile:
          version: 12
      dependencies: []
`;

const ORPHAN_PLACE_YAML = `
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
    - id: place_orphan
      inputs:
        place:
          isStart: false
      outputs:
        place:
          assetId: 9999999999
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.config.universe?.universeId).toBe("6031475575");
	});

	it("should return primaryEnvironmentRequired with an empty available list when no environments are declared", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
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
			configFormat: "typescript",
			readFile: async () => {
				throw numeric;
			},
			stateFilePath: "/tmp/.mantle-state.yml",
		});

		await expect(promise).rejects.toBe(numeric);
	});

	it("should fold a matched place pair into the root config places block", async () => {
		expect.assertions(1);

		const result = await migrateMantleState({
			configFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_WITH_PLACE_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.config.places).toStrictEqual({ start: { filePath: "place.rbxl" } });
	});

	it("should put the placeId on the primary environment overlay", async () => {
		expect.assertions(1);

		const result = await migrateMantleState({
			configFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_WITH_PLACE_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.config.environments["production"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
	});

	it("should emit a place ResourceCurrentState carrying the Mantle-recorded place version", async () => {
		expect.assertions(4);

		const result = await migrateMantleState({
			configFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_WITH_PLACE_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		const state = result.data.statesByEnvironment["production"];
		assert(state !== undefined);

		const placeResource = state.resources.find((resource) => resource.kind === "place");
		assert(placeResource?.kind === "place");

		expect(placeResource.key).toBe("start");
		expect(placeResource.placeId).toBe("17613681043");
		expect(placeResource.filePath).toBe("place.rbxl");
		expect(placeResource.outputs.versionNumber).toBe(53);
	});

	it("should emit an ambiguous warning prefixed by the environment for an orphan place", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			configFormat: "typescript",
			readFile: fakeReadFile(ORPHAN_PLACE_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.warnings).toHaveLength(1);

		const [warning] = result.data.warnings;
		assert(warning?.kind === "ambiguous");

		expect(warning.mantlePath).toBe("production.place_orphan");
		expect(result.data.summary.ambiguousCount).toBe(1);
	});

	it("should override filePath on a non-primary overlay when it diverges from the primary", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			readFile: fakeReadFile(TWO_ENV_PLACE_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.config.places?.["start"]?.filePath).toBe("place.rbxlx");
		expect(result.data.config.environments["production"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { filePath: "place.rbxl", placeId: "2222222222" },
		});
	});

	it("should keep each environment's BedrockState place resource truthful to its own values", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			readFile: fakeReadFile(TWO_ENV_PLACE_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		const { development, production } = result.data.statesByEnvironment;
		assert(development !== undefined && production !== undefined);

		const developmentPlace = development.resources.find(
			(resource) => resource.kind === "place",
		);
		const productionPlace = production.resources.find((resource) => resource.kind === "place");
		assert(developmentPlace?.kind === "place" && productionPlace?.kind === "place");

		expect(developmentPlace.placeId).toBe("2222222222");
		expect(productionPlace.placeId).toBe("17613681043");
	});

	it("should omit the root places block when the primary environment has no place resources", async () => {
		expect.assertions(1);

		const result = await migrateMantleState({
			configFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.config.places).toBeUndefined();
	});

	it("should omit filePath from a non-primary overlay when it matches the primary's filePath", async () => {
		expect.assertions(1);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			readFile: fakeReadFile(TWO_ENV_PLACE_SAME_PATH_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "2222222222" },
		});
	});

	it("should stamp the source state path and the now()-supplied timestamp into the TypeScript header", async () => {
		expect.assertions(3);

		const generatedAt = new Date("2026-04-27T03:12:00.000Z");
		const result = await migrateMantleState({
			configFormat: "typescript",
			now: () => generatedAt,
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: "/work/.mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.configFileContent).toStartWith(
			`// Generated by bedrock migrate v${manifest.version} from /work/.mantle-state.yml at 2026-04-27T03:12:00.000Z`,
		);
		expect(result.data.configFileContent).toContain("/work/.mantle-state.yml");
		expect(result.data.configFileContent).toContain("2026-04-27T03:12:00.000Z");
	});

	it("should emit a YAML configFileContent when configFormat is yaml", async () => {
		expect.assertions(4);

		const generatedAt = new Date("2026-04-27T03:12:00.000Z");
		const result = await migrateMantleState({
			configFormat: "yaml",
			now: () => generatedAt,
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		expect(result.data.configFileContent).toStartWith(
			`# Generated by bedrock migrate v${manifest.version} from .mantle-state.yml at 2026-04-27T03:12:00.000Z`,
		);
		expect(result.data.configFileContent).toContain("2026-04-27T03:12:00.000Z");
		expect(result.data.configFileContent).toContain("universeId: '6031475575'");
		expect(result.data.configFileContent).not.toContain("defineConfig");
	});

	it("should default the now supplier to a fresh Date when the caller omits it", async () => {
		expect.assertions(1);

		const before = Date.now();
		const result = await migrateMantleState({
			configFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});
		const after = Date.now();

		assert(result.success);

		const match = /at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/.exec(
			result.data.configFileContent,
		);
		assert(match !== null);
		const stamped = Date.parse(match[1]!);

		expect(stamped).toBeWithin(before, after + 1);
	});
});
