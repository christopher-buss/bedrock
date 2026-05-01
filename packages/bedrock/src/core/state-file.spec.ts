import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { parseStateFile, serializeStateFile } from "./state-file.ts";
import type { BedrockState } from "./state.ts";

describe(serializeStateFile, () => {
	it("should wrap an empty state with a $bedrock version envelope", () => {
		expect.assertions(1);

		const state: BedrockState = {
			environment: "production",
			resources: [],
			version: 1,
		};

		expect(JSON.parse(serializeStateFile(state))).toStrictEqual({
			$bedrock: { version: 1 },
			environment: "production",
			resources: [],
		});
	});

	it("should preserve resource entries verbatim under the envelope", () => {
		expect.assertions(1);

		const state: BedrockState = {
			environment: "staging",
			resources: [
				{
					key: asResourceKey("vip-pass"),
					name: "VIP Pass",
					description: "Grants VIP perks.",
					icon: { "en-us": "assets/vip-icon.png" },
					iconFileHashes: {
						"en-us": asSha256Hex(
							"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
						),
					},
					kind: "gamePass",
					outputs: {
						assetId: asRobloxAssetId("9876543210"),
						iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
					},
					price: 500,
				},
			],
			version: 1,
		};

		expect(JSON.parse(serializeStateFile(state))).toStrictEqual({
			$bedrock: { version: 1 },
			environment: "staging",
			resources: [
				{
					key: "vip-pass",
					name: "VIP Pass",
					description: "Grants VIP perks.",
					icon: { "en-us": "assets/vip-icon.png" },
					iconFileHashes: {
						"en-us": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					},
					kind: "gamePass",
					outputs: {
						assetId: "9876543210",
						iconAssetIds: { "en-us": "1122334455" },
					},
					price: 500,
				},
			],
		});
	});

	it("should produce human-readable indented json", () => {
		expect.assertions(1);

		const state: BedrockState = {
			environment: "production",
			resources: [],
			version: 1,
		};

		expect(serializeStateFile(state)).toContain("\n");
	});
});

const SAMPLE_FILE = "gist:abc123/state.production.json";

describe(parseStateFile, () => {
	it("should return ok(undefined) when the input is undefined", () => {
		expect.assertions(2);

		const result = parseStateFile(undefined, SAMPLE_FILE);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBeUndefined();
	});

	it("should round-trip a populated state written by serializeStateFile", () => {
		expect.assertions(2);

		const state: BedrockState = {
			environment: "staging",
			resources: [
				{
					key: asResourceKey("vip-pass"),
					name: "VIP Pass",
					description: "Grants VIP perks.",
					icon: { "en-us": "assets/vip-icon.png" },
					iconFileHashes: {
						"en-us": asSha256Hex(
							"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
						),
					},
					kind: "gamePass",
					outputs: {
						assetId: asRobloxAssetId("9876543210"),
						iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
					},
					price: 500,
				},
			],
			version: 1,
		};

		const result = parseStateFile(serializeStateFile(state), SAMPLE_FILE);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual(state);
	});

	it("should round-trip a developer-product resource through serialize and parse", () => {
		expect.assertions(2);

		const state: BedrockState = {
			environment: "production",
			resources: [
				{
					key: asResourceKey("gem-pack"),
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					isRegionalPricingEnabled: true,
					kind: "developerProduct",
					outputs: {
						productId: asRobloxAssetId("8172635495"),
					},
					price: 100,
					storePageEnabled: false,
				},
			],
			version: 1,
		};

		const result = parseStateFile(serializeStateFile(state), SAMPLE_FILE);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual(state);
	});

	it("should err when a resource is missing its kind discriminator", () => {
		expect.assertions(1);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: { version: 1 },
				environment: "production",
				resources: [{ key: "vip-pass", outputs: {} }],
			}),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();
	});

	it("should round-trip an empty state written by serializeStateFile", () => {
		expect.assertions(2);

		const raw = serializeStateFile({
			environment: "production",
			resources: [],
			version: 1,
		});

		const result = parseStateFile(raw, SAMPLE_FILE);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual({
			environment: "production",
			resources: [],
			version: 1,
		});
	});

	it("should err with a malformed-json reason when the raw bytes are not valid json", () => {
		expect.assertions(3);

		const result = parseStateFile("{ not valid", SAMPLE_FILE);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err).toMatchObject({ file: SAMPLE_FILE, kind: "stateError" });
		expect(result.err.reason).toMatch(/malformed JSON/u);
	});

	it("should err with an invalid-state-file reason when the $bedrock envelope is missing", () => {
		expect.assertions(2);

		const result = parseStateFile(
			JSON.stringify({ environment: "production", resources: [] }),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err.reason).toMatch(/invalid state file/u);
	});

	it("should err when the schema version is not 1", () => {
		expect.assertions(1);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: { version: 2 },
				environment: "production",
				resources: [],
			}),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();
	});

	it("should err when the environment is missing", () => {
		expect.assertions(1);

		const result = parseStateFile(
			JSON.stringify({ $bedrock: { version: 1 }, resources: [] }),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();
	});

	it("should err when resources is not an array", () => {
		expect.assertions(1);

		const result = parseStateFile(
			JSON.stringify({ $bedrock: { version: 1 }, environment: "production", resources: {} }),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();
	});
});
