import { describe, it, vi } from "vitest";

import { environmentFrom } from "#tests/helpers/environment";
import { asRobloxAssetId } from "../types/ids.ts";
import { parseImportOptions } from "./parse-import-options.ts";

const noEnvironment = environmentFrom({});

describe(parseImportOptions, () => {
	it("should read the Environment, each selection, the credentials and --yes", ({ expect }) => {
		expect.assertions(1);

		const parsed = parseImportOptions(
			{
				"api-key": "key",
				"config": "bedrock.config.yaml",
				"environment": "production",
				"github-token": "token",
				"select": ["game-pass:11", "developerProduct:22", "badge:33"],
				"verbose": true,
				"yes": true,
			},
			noEnvironment,
		);

		expect(parsed).toStrictEqual({
			data: {
				apiKey: "key",
				configFile: "bedrock.config.yaml",
				environment: "production",
				githubToken: "token",
				selections: [
					{ kind: "gamePass", robloxId: asRobloxAssetId("11") },
					{ kind: "developerProduct", robloxId: asRobloxAssetId("22") },
					{ kind: "badge", robloxId: asRobloxAssetId("33") },
				],
				verbose: true,
				yes: true,
			},
			success: true,
		});
	});

	it("should take the Environment from BEDROCK_ENVIRONMENT and accept one --select", ({
		expect,
	}) => {
		expect.assertions(1);

		const parsed = parseImportOptions(
			{ select: "gamePass:11", yes: true },
			environmentFrom({ BEDROCK_ENVIRONMENT: "staging" }),
		);

		expect(parsed).toMatchObject({
			data: {
				environment: "staging",
				selections: [{ kind: "gamePass", robloxId: "11" }],
				verbose: false,
			},
			success: true,
		});
	});

	it("should read BEDROCK_ENVIRONMENT from the process by default", ({ expect }) => {
		expect.assertions(1);

		vi.stubEnv("BEDROCK_ENVIRONMENT", "from-process");

		expect(parseImportOptions({})).toMatchObject({
			data: { environment: "from-process" },
			success: true,
		});
	});

	it("should leave --yes off and the selections empty when they are not given", ({ expect }) => {
		expect.assertions(1);

		expect(parseImportOptions({ environment: "production" }, noEnvironment)).toStrictEqual({
			data: { environment: "production", selections: [], verbose: false, yes: false },
			success: true,
		});
	});

	it.for([
		[
			{ environment: "production", other: 1 },
			{ flag: "other", kind: "unknownFlag" },
		],
		[{}, { flag: "environment", kind: "missingRequired" }],
		[{ environment: ["a", "b"] }, { flag: "environment", kind: "invalidValue" }],
		[{ environment: "" }, { flag: "environment", kind: "invalidValue" }],
		[
			{ environment: "production", yes: "no" },
			{ flag: "yes", kind: "switchGivenValue" },
		],
		[
			{ environment: "production", verbose: "no" },
			{ flag: "verbose", kind: "switchGivenValue" },
		],
		[
			{ environment: "production", select: "place:1" },
			{ kind: "invalidSelection", received: "place:1" },
		],
		[
			{ environment: "production", select: "badge:x1" },
			{ kind: "invalidSelection", received: "badge:x1" },
		],
		[
			{ environment: "production", select: "badge:1:2" },
			{ kind: "invalidSelection", received: "badge:1:2" },
		],
		[
			{ environment: "production", select: [1] },
			{ flag: "select", kind: "invalidValue" },
		],
	] as const)("should refuse %o", ([raw, err], { expect }) => {
		expect.assertions(1);

		expect(parseImportOptions(raw, noEnvironment)).toStrictEqual({ err, success: false });
	});
});
