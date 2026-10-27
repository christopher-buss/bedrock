import { assert, describe, it } from "vitest";

import { badgeCurrent } from "#tests/helpers/resources";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { parseStateFile, serializeStateFile } from "./state-file.ts";
import type { BedrockState } from "./state.ts";

describe(serializeStateFile, () => {
	it("should wrap an empty state with a $bedrock version envelope", ({ expect }) => {
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

	it("should preserve resource entries verbatim under the envelope", ({ expect }) => {
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

	it("should produce human-readable indented json", ({ expect }) => {
		expect.assertions(1);

		const state: BedrockState = {
			environment: "production",
			resources: [],
			version: 1,
		};

		expect(serializeStateFile(state)).toContain("\n");
	});

	it("should serialize pending-rebuild place keys into the $bedrock envelope", ({ expect }) => {
		expect.assertions(1);

		const state: BedrockState = {
			environment: "production",
			pendingRebuild: new Set([asResourceKey("lobby"), asResourceKey("start-place")]),
			resources: [],
			version: 1,
		};

		expect(JSON.parse(serializeStateFile(state))).toStrictEqual({
			$bedrock: { pendingRebuild: ["lobby", "start-place"], version: 1 },
			environment: "production",
			resources: [],
		});
	});

	it("should omit pending-rebuild from the envelope when the marker set is empty", ({
		expect,
	}) => {
		expect.assertions(1);

		const state: BedrockState = {
			environment: "production",
			pendingRebuild: new Set(),
			resources: [],
			version: 1,
		};

		expect(JSON.parse(serializeStateFile(state))).toStrictEqual({
			$bedrock: { version: 1 },
			environment: "production",
			resources: [],
		});
	});

	it("should serialize the codegen hash into the $bedrock envelope", ({ expect }) => {
		expect.assertions(1);

		const state: BedrockState = {
			codegenHash: asSha256Hex(
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			),
			environment: "production",
			resources: [],
			version: 1,
		};

		expect(JSON.parse(serializeStateFile(state))).toStrictEqual({
			$bedrock: {
				codegenHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				version: 1,
			},
			environment: "production",
			resources: [],
		});
	});

	it("should omit the codegen hash from the envelope when it is absent", ({ expect }) => {
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
});

const SAMPLE_FILE = "gist:abc123/state.production.json";

describe(parseStateFile, () => {
	it("should return ok(undefined) when the input is undefined", ({ expect }) => {
		expect.assertions(2);

		const result = parseStateFile(undefined, SAMPLE_FILE);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBeUndefined();
	});

	it("should round-trip a populated state written by serializeStateFile", ({ expect }) => {
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

	it("should round-trip a badge resource through serialize and parse", ({ expect }) => {
		expect.assertions(1);

		const state = {
			environment: "production",
			resources: [badgeCurrent()],
			version: 1,
		} satisfies BedrockState;

		expect(parseStateFile(serializeStateFile(state), SAMPLE_FILE)).toStrictEqual({
			data: state,
			success: true,
		});
	});

	it("should round-trip a developer-product resource through serialize and parse", ({
		expect,
	}) => {
		expect.assertions(2);

		const state: BedrockState = {
			environment: "production",
			resources: [
				{
					key: asResourceKey("gem-pack"),
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					kind: "developerProduct",
					outputs: {
						productId: asRobloxAssetId("8172635495"),
					},
					price: 100,
				},
			],
			version: 1,
		};

		const result = parseStateFile(serializeStateFile(state), SAMPLE_FILE);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual(state);
	});

	it("should load a developer product written before Roblox retired its pricing and store-page fields, dropping them", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: { version: 1 },
				environment: "production",
				resources: [
					{
						key: "gem-pack",
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						isRegionalPricingEnabled: true,
						kind: "developerProduct",
						outputs: { productId: "8172635495" },
						price: 100,
						storePageEnabled: false,
					},
				],
			}),
			SAMPLE_FILE,
		);

		assert(result.success);
		assert(result.data !== undefined);

		expect(result.data.resources).toStrictEqual([
			{
				key: asResourceKey("gem-pack"),
				name: "Gem Pack",
				description: "Stocks the player up with 1,000 premium gems.",
				kind: "developerProduct",
				outputs: { productId: asRobloxAssetId("8172635495") },
				price: 100,
			},
		]);
	});

	it("should err when a resource is missing its kind discriminator", ({ expect }) => {
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

	it("should round-trip an empty state written by serializeStateFile", ({ expect }) => {
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

	it("should err with a malformed-json reason when the raw bytes are not valid json", ({
		expect,
	}) => {
		expect.assertions(3);

		const result = parseStateFile("{ not valid", SAMPLE_FILE);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err).toMatchObject({ file: SAMPLE_FILE, kind: "stateError" });
		expect(result.err.reason).toMatch(/malformed JSON/u);
	});

	it("should err with an invalid-state-file reason when the $bedrock envelope is missing", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = parseStateFile(
			JSON.stringify({ environment: "production", resources: [] }),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err.reason).toMatch(/invalid state file/u);
	});

	it("should err when the schema version is not 1", ({ expect }) => {
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

	it("should err when the environment is missing", ({ expect }) => {
		expect.assertions(1);

		const result = parseStateFile(
			JSON.stringify({ $bedrock: { version: 1 }, resources: [] }),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();
	});

	it("should err when resources is not an array", ({ expect }) => {
		expect.assertions(1);

		const result = parseStateFile(
			JSON.stringify({ $bedrock: { version: 1 }, environment: "production", resources: {} }),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();
	});

	it("should round-trip pending-rebuild markers through serialize and parse", ({ expect }) => {
		expect.assertions(2);

		const state: BedrockState = {
			environment: "staging",
			pendingRebuild: new Set([asResourceKey("start-place")]),
			resources: [],
			version: 1,
		};

		const result = parseStateFile(serializeStateFile(state), SAMPLE_FILE);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual(state);
	});

	it("should hydrate pending-rebuild markers from a $bedrock envelope list", ({ expect }) => {
		expect.assertions(2);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: { pendingRebuild: ["start-place", "lobby"], version: 1 },
				environment: "production",
				resources: [],
			}),
			SAMPLE_FILE,
		);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual({
			environment: "production",
			pendingRebuild: new Set([asResourceKey("lobby"), asResourceKey("start-place")]),
			resources: [],
			version: 1,
		});
	});

	it("should omit pending-rebuild when the envelope list is empty", ({ expect }) => {
		expect.assertions(2);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: { pendingRebuild: [], version: 1 },
				environment: "production",
				resources: [],
			}),
			SAMPLE_FILE,
		);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual({
			environment: "production",
			resources: [],
			version: 1,
		});
	});

	it("should round-trip the codegen hash through serialize and parse", ({ expect }) => {
		expect.assertions(2);

		const state: BedrockState = {
			codegenHash: asSha256Hex(
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			),
			environment: "staging",
			resources: [],
			version: 1,
		};

		const result = parseStateFile(serializeStateFile(state), SAMPLE_FILE);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual(state);
	});

	it("should hydrate the codegen hash from a $bedrock envelope", ({ expect }) => {
		expect.assertions(2);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: {
					codegenHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					version: 1,
				},
				environment: "production",
				resources: [],
			}),
			SAMPLE_FILE,
		);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual({
			codegenHash: asSha256Hex(
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			),
			environment: "production",
			resources: [],
			version: 1,
		});
	});

	it("should err when the codegen hash is not a 64-character lowercase hex digest", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: { codegenHash: "not-a-valid-hash", version: 1 },
				environment: "production",
				resources: [],
			}),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();
	});

	it("should parse a v1 state file without pendingRebuild and leave version unchanged", ({
		expect,
	}) => {
		expect.assertions(3);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: { version: 1 },
				environment: "production",
				resources: [],
			}),
			SAMPLE_FILE,
		);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toStrictEqual({
			environment: "production",
			resources: [],
			version: 1,
		});
		expect(result.data!.pendingRebuild).toBeUndefined();
	});

	it("should err when pendingRebuild is not a list of strings", ({ expect }) => {
		expect.assertions(1);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: { pendingRebuild: "start-place", version: 1 },
				environment: "production",
				resources: [],
			}),
			SAMPLE_FILE,
		);

		expect(result.success).toBeFalse();
	});

	it("should tolerate and drop an unknown $bedrock member for forward compatibility", ({
		expect,
	}) => {
		expect.assertions(3);

		const result = parseStateFile(
			JSON.stringify({
				$bedrock: { futureThing: "x", version: 1 },
				environment: "production",
				resources: [],
			}),
			SAMPLE_FILE,
		);

		expect(result.success).toBeTrue();

		assert(result.success);
		assert(result.data !== undefined);

		expect(result.data).toStrictEqual({
			environment: "production",
			resources: [],
			version: 1,
		});

		expect(JSON.parse(serializeStateFile(result.data))).toStrictEqual({
			$bedrock: { version: 1 },
			environment: "production",
			resources: [],
		});
	});
});
