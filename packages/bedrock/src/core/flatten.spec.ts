import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { flattenConfig } from "./flatten.ts";
import { validateConfig } from "./schema.ts";

describe(flattenConfig, () => {
	it("should return an empty array for a config without resource collections", () => {
		expect.assertions(1);

		const config = validateConfig({}, "bedrock.config.ts");
		assert(config.success);

		expect(flattenConfig(config.data)).toStrictEqual([]);
	});

	it("should tag a passes entry with kind gamePass and the ResourceKey-branded key", () => {
		expect.assertions(1);

		const config = validateConfig(
			{
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						iconFilePath: "assets/vip-icon.png",
						price: 500,
					},
				},
			},
			"bedrock.config.ts",
		);
		assert(config.success);

		expect(flattenConfig(config.data)).toStrictEqual([
			{
				key: asResourceKey("vip-pass"),
				name: "VIP Pass",
				description: "Grants VIP perks.",
				iconFilePath: "assets/vip-icon.png",
				kind: "gamePass",
				price: 500,
			},
		]);
	});

	it("should carry price as undefined when the entry omits it", () => {
		expect.assertions(1);

		const config = validateConfig(
			{
				passes: {
					"free-pass": {
						name: "Free",
						description: "Free pass.",
						iconFilePath: "assets/free.png",
					},
				},
			},
			"bedrock.config.ts",
		);
		assert(config.success);

		const input = flattenConfig(config.data)[0]!;
		assert(input.kind === "gamePass");

		expect(input.price).toBeUndefined();
	});

	it("should preserve the insertion order of passes entries", () => {
		expect.assertions(1);

		const config = validateConfig(
			{
				passes: {
					alpha: {
						name: "A",
						description: "A.",
						iconFilePath: "a.png",
					},
					beta: {
						name: "B",
						description: "B.",
						iconFilePath: "b.png",
					},
					gamma: {
						name: "G",
						description: "G.",
						iconFilePath: "g.png",
					},
				},
			},
			"bedrock.config.ts",
		);
		assert(config.success);

		expect(flattenConfig(config.data).map((input) => input.key)).toStrictEqual([
			"alpha",
			"beta",
			"gamma",
		]);
	});

	it("should tag a places entry with kind place and brand placeId as a RobloxAssetId", () => {
		expect.assertions(1);

		const config = validateConfig(
			{
				places: {
					"start-place": { filePath: "places/start.rbxl", placeId: "4711" },
				},
			},
			"bedrock.config.ts",
		);
		assert(config.success);

		expect(flattenConfig(config.data)).toStrictEqual([
			{
				key: asResourceKey("start-place"),
				filePath: "places/start.rbxl",
				kind: "place",
				placeId: asRobloxAssetId("4711"),
			},
		]);
	});

	it("should emit passes before places when both collections are declared", () => {
		expect.assertions(1);

		const config = validateConfig(
			{
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						iconFilePath: "assets/vip.png",
					},
				},
				places: {
					"start-place": { filePath: "places/start.rbxl", placeId: "4711" },
				},
			},
			"bedrock.config.ts",
		);
		assert(config.success);

		expect(flattenConfig(config.data).map((input) => input.kind)).toStrictEqual([
			"gamePass",
			"place",
		]);
	});
});
