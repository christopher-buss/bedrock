import { describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { serializeStateFile } from "./state-file.ts";
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
					iconFileHash: asSha256Hex(
						"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					),
					iconFilePath: "assets/vip-icon.png",
					kind: "gamePass",
					outputs: {
						assetId: asRobloxAssetId("9876543210"),
						iconAssetId: asRobloxAssetId("1122334455"),
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
					iconFileHash:
						"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					iconFilePath: "assets/vip-icon.png",
					kind: "gamePass",
					outputs: {
						assetId: "9876543210",
						iconAssetId: "1122334455",
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
