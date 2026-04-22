import { assert, describe, expect, it } from "vitest";

import { asResourceKey } from "../types/ids.ts";
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

		expect(flattenConfig(config.data)[0]!.price).toBeUndefined();
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
});
