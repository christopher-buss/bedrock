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

	it("should produce one placeholder BedrockState per environment", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			readFile: fakeReadFile(SINGLE_ENV_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		const state = result.data.statesByEnvironment["production"];
		assert(state !== undefined);

		expect(state.environment).toBe("production");
		expect(state.version).toBe(1);
		expect(state.resources).toStrictEqual([]);
	});

	it("should emit zero warnings, a zeroed summary, and an empty configFileContent in the skeleton", async () => {
		expect.assertions(3);

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
		expect(result.data.configFileContent).toBe("");
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
