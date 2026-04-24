import { PLATFORM_FLAG_ROWS } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { flattenConfig } from "./flatten.ts";
import { SOCIAL_LINK_FIELDS, UNIVERSE_SINGLETON_KEY } from "./resources.ts";
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

	it("should tag a universe block with the singleton key and brand universeId as a RobloxAssetId", () => {
		expect.assertions(1);

		const config = validateConfig(
			{ universe: { universeId: "1234567890", voiceChatEnabled: true } },
			"bedrock.config.ts",
		);
		assert(config.success);

		expect(flattenConfig(config.data)).toStrictEqual([
			{
				key: UNIVERSE_SINGLETON_KEY,
				consoleEnabled: undefined,
				desktopEnabled: undefined,
				displayName: undefined,
				kind: "universe",
				mobileEnabled: undefined,
				tabletEnabled: undefined,
				universeId: asRobloxAssetId("1234567890"),
				visibility: undefined,
				voiceChatEnabled: true,
				vrEnabled: undefined,
			},
		]);
	});

	it("should emit the universe block after places when all three are declared", () => {
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
				universe: { universeId: "1234567890" },
			},
			"bedrock.config.ts",
		);
		assert(config.success);

		expect(flattenConfig(config.data).map((input) => input.kind)).toStrictEqual([
			"gamePass",
			"place",
			"universe",
		]);
	});

	it("should carry voiceChatEnabled as undefined when the universe entry omits it", () => {
		expect.assertions(1);

		const config = validateConfig(
			{ universe: { universeId: "1234567890" } },
			"bedrock.config.ts",
		);
		assert(config.success);

		const input = flattenConfig(config.data)[0]!;
		assert(input.kind === "universe");

		expect(input.voiceChatEnabled).toBeUndefined();
	});

	it.for(PLATFORM_FLAG_ROWS)(
		"should propagate a declared %s through to the universe input",
		([flag]) => {
			expect.assertions(1);

			const config = validateConfig(
				{ universe: { [flag]: true, universeId: "1234567890" } },
				"bedrock.config.ts",
			);
			assert(config.success);

			const input = flattenConfig(config.data)[0]!;
			assert(input.kind === "universe");

			expect(input[flag]).toBeTrue();
		},
	);

	it.for(PLATFORM_FLAG_ROWS)(
		"should carry %s as undefined when the universe entry omits it",
		([flag]) => {
			expect.assertions(1);

			const config = validateConfig(
				{ universe: { universeId: "1234567890" } },
				"bedrock.config.ts",
			);
			assert(config.success);

			const input = flattenConfig(config.data)[0]!;
			assert(input.kind === "universe");

			expect(input[flag]).toBeUndefined();
		},
	);

	it("should carry every declared universe managed field onto the input", () => {
		expect.assertions(5);

		const config = validateConfig(
			{
				universe: {
					displayName: "Fun Universe",
					privateServerPriceRobux: 250,
					universeId: "1234567890",
					visibility: "public",
					voiceChatEnabled: true,
				},
			},
			"bedrock.config.ts",
		);
		assert(config.success);

		const input = flattenConfig(config.data)[0]!;
		assert(input.kind === "universe");

		expect(input.displayName).toBe("Fun Universe");
		expect(input.visibility).toBe("public");
		expect(input.privateServerPriceRobux).toBe(250);
		expect(input.voiceChatEnabled).toBeTrue();
		expect(input.universeId).toBe(asRobloxAssetId("1234567890"));
	});

	it("should preserve key-presence when privateServerPriceRobux is declared as undefined", () => {
		expect.assertions(2);

		const config = validateConfig(
			{
				universe: {
					privateServerPriceRobux: undefined,
					universeId: "1234567890",
				},
			},
			"bedrock.config.ts",
		);
		assert(config.success);

		const input = flattenConfig(config.data)[0]!;
		assert(input.kind === "universe");

		expect("privateServerPriceRobux" in input).toBeTrue();
		expect(input.privateServerPriceRobux).toBeUndefined();
	});

	it("should omit privateServerPriceRobux from the input when the user does not declare it", () => {
		expect.assertions(1);

		const config = validateConfig(
			{ universe: { universeId: "1234567890" } },
			"bedrock.config.ts",
		);
		assert(config.success);

		const input = flattenConfig(config.data)[0]!;
		assert(input.kind === "universe");

		expect("privateServerPriceRobux" in input).toBeFalse();
	});

	it("should omit the universe block from output when the config has no universe", () => {
		expect.assertions(1);

		const config = validateConfig({}, "bedrock.config.ts");
		assert(config.success);

		expect(flattenConfig(config.data).some((input) => input.kind === "universe")).toBeFalse();
	});

	it.for(SOCIAL_LINK_FIELDS)(
		"should forward %s with its declared SocialLink value on the universe input",
		(field) => {
			expect.assertions(2);

			const value = { title: `t-${field}`, uri: `https://example.com/${field}` };
			const config = validateConfig(
				{ universe: { [field]: value, universeId: "1234567890" } },
				"bedrock.config.ts",
			);
			assert(config.success);

			const input = flattenConfig(config.data)[0]!;
			assert(input.kind === "universe");

			expect(input).toContainKey(field);
			expect(input[field]).toStrictEqual(value);
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should forward %s declared as undefined and preserve the key on the universe input",
		(field) => {
			expect.assertions(2);

			const config = validateConfig(
				{ universe: { [field]: undefined, universeId: "1234567890" } },
				"bedrock.config.ts",
			);
			assert(config.success);

			const input = flattenConfig(config.data)[0]!;
			assert(input.kind === "universe");

			expect(input).toContainKey(field);
			expect(input[field]).toBeUndefined();
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should omit %s from the universe input when the key is absent in the config",
		(field) => {
			expect.assertions(1);

			const config = validateConfig(
				{ universe: { universeId: "1234567890" } },
				"bedrock.config.ts",
			);
			assert(config.success);

			const input = flattenConfig(config.data)[0]!;
			assert(input.kind === "universe");

			expect(input).not.toContainKey(field);
		},
	);

	it("should forward a mix of declared and omitted social links on the universe input", () => {
		expect.assertions(4);

		const discord = { title: "Discord", uri: "https://discord.gg/example" };
		const config = validateConfig(
			{
				universe: {
					discordSocialLink: discord,
					twitterSocialLink: undefined,
					universeId: "1234567890",
				},
			},
			"bedrock.config.ts",
		);
		assert(config.success);

		const input = flattenConfig(config.data)[0]!;
		assert(input.kind === "universe");

		expect(input).toContainKey("discordSocialLink");
		expect(input.discordSocialLink).toStrictEqual(discord);
		expect(input).toContainKey("twitterSocialLink");
		expect(input).not.toContainKey("facebookSocialLink");
	});
});
