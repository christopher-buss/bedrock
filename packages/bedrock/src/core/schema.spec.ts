import { INVALID_ROBUX_PRICES, PLATFORM_FLAG_ROWS } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { SOCIAL_LINK_FIELDS } from "./resources.ts";
import { validateConfig } from "./schema.ts";

const SOURCE = "bedrock.config.ts";

const MinEnvironments = { production: {} } as const;

describe(validateConfig, () => {
	it("should reject a config missing the required environments collection", () => {
		expect.assertions(1);

		const result = validateConfig({}, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["environments"]);
	});

	it("should reject a config whose environments collection is empty", () => {
		expect.assertions(2);

		const result = validateConfig({ environments: {} }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["environments"]);
		expect(result.err.issues[0]!.message).toContain(
			"environments record with at least one declared environment",
		);
	});

	it("should accept a minimal config that declares only environments", () => {
		expect.assertions(1);

		const result = validateConfig({ environments: MinEnvironments }, SOURCE);

		assert(result.success);

		expect(result.data.environments).toContainKey("production");
	});

	it("should accept the reserved extends key at the root", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, extends: "./base.config.ts" },
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it("should reject unknown top-level keys and point the issue path at the offending key", () => {
		expect.assertions(3);

		const result = validateConfig({ environments: MinEnvironments, unexpected: {} }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.sourceFile).toBe(SOURCE);
		expect(result.err.issues).toHaveLength(1);
		expect(result.err.issues[0]!.path).toStrictEqual(["unexpected"]);
	});

	it("should accept a passes collection with a valid game-pass entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip.png" },
						price: 500,
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.passes!["vip-pass"]!.price).toBe(500);
	});

	it("should default price to undefined when omitted on a passes entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"free-pass": {
						name: "Free Pass",
						description: "Free pass.",
						icon: { "en-us": "assets/free.png" },
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.passes!["free-pass"]!.price).toBeUndefined();
	});

	it("should reject a passes key that does not match the ResourceKey pattern and attribute the issue path to that key", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"bad key!": {
						name: "Bad",
						description: "Invalid key.",
						icon: { "en-us": "assets/bad.png" },
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["passes", "bad key!"]);
	});

	it("should reject a passes entry missing a required icon field and attribute the issue path to that field", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP",
						description: "Missing icon.",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "icon"]);
	});

	it("should reject a passes icon map declaring a locale other than 'en-us'", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/en.png", "fr-fr": "assets/fr.png" },
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "icon", "fr-fr"]);
	});

	it("should reject a passes icon map missing the 'en-us' key", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP",
						description: "Grants VIP perks.",
						icon: {},
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "icon", "en-us"]);
	});

	it("should reject a wrongly-typed field and attribute the issue path to that field", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP",
						description: "Bad price.",
						icon: { "en-us": "assets/vip.png" },
						price: "oops",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "price"]);
	});

	it.for(INVALID_ROBUX_PRICES)(
		"should reject %s as a passes price and attribute the issue path to that field",
		([, price]) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					passes: {
						"vip-pass": {
							name: "VIP Pass",
							description: "Grants VIP perks.",
							icon: { "en-us": "assets/vip.png" },
							price,
						},
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "price"]);
		},
	);

	it.for([
		["true", true],
		["false", false],
	] as const)("should accept a passes entry with redacted: %s", ([, redacted]) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip.png" },
						redacted,
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.passes!["vip-pass"]!.redacted).toBe(redacted);
	});

	it.for([
		["partial name override", { name: "Closed Beta" }],
		["partial description override", { description: "Coming soon." }],
		["partial icon override", { icon: { "en-us": "assets/closed-beta.png" } }],
		[
			"full override",
			{
				name: "Closed Beta",
				description: "Coming soon.",
				icon: { "en-us": "assets/closed-beta.png" },
			},
		],
	] as const)(
		"should accept a passes entry with redacted as the %s object form",
		([, redacted]) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					passes: {
						"vip-pass": {
							name: "VIP Pass",
							description: "Grants VIP perks.",
							icon: { "en-us": "assets/vip.png" },
							redacted,
						},
					},
				},
				SOURCE,
			);

			assert(result.success);

			expect(result.data.passes!["vip-pass"]!.redacted).toStrictEqual(redacted);
		},
	);

	it("should default redacted to undefined when omitted on a passes entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip.png" },
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.passes!["vip-pass"]!.redacted).toBeUndefined();
	});

	it.for([
		["string", "true"],
		["number", 1],
		// eslint-disable-next-line unicorn/no-null -- testing that arktype rejects the json null literal
		["null", null],
	] as const)(
		"should reject %s as a passes redacted field and attribute the issue path to that field",
		([, redacted]) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					passes: {
						"vip-pass": {
							name: "VIP Pass",
							description: "Grants VIP perks.",
							icon: { "en-us": "assets/vip.png" },
							redacted,
						},
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "redacted"]);
		},
	);

	it("should reject an empty redacted object and recommend redacted: true for default placeholders", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip.png" },
						redacted: {},
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "redacted"]);
		expect(result.err.issues[0]!.message).toContain("redacted: true");
	});

	it("should reject an unknown key in a redacted override and attribute the issue path to the offending key", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip.png" },
						redacted: { price: 0 },
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"passes",
			"vip-pass",
			"redacted",
			"price",
		]);
		expect(result.err.issues[0]!.message).toContain("price");
	});

	it("should accept a products collection with a valid developer-product entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.products!["gem-pack"]!.name).toBe("Gem Pack");
	});

	it("should reject a products key that does not match the ResourceKey pattern and attribute the issue path to that key", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"bad key!": {
						name: "Bad",
						description: "Invalid key.",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["products", "bad key!"]);
	});

	it("should reject a products entry missing a required field and attribute the issue path to that field", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["products", "gem-pack", "description"]);
	});

	it("should accept a products entry that declares an optional price", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						price: 100,
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.products!["gem-pack"]!.price).toBe(100);
	});

	it("should reject a wrongly-typed price on a root products entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						price: "oops",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["products", "gem-pack", "price"]);
	});

	it.for(INVALID_ROBUX_PRICES)(
		"should reject %s as a products price and attribute the issue path to that field",
		([, price]) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					products: {
						"gem-pack": {
							name: "Gem Pack",
							description: "Stocks the player up with 1,000 premium gems.",
							price,
						},
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["products", "gem-pack", "price"]);
		},
	);

	it("should reject an undeclared field on a root products entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						isForSale: true,
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["products", "gem-pack", "isForSale"]);
	});

	it("should accept a products entry that declares isRegionalPricingEnabled and storePageEnabled", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						isRegionalPricingEnabled: true,
						storePageEnabled: false,
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.products!["gem-pack"]!.isRegionalPricingEnabled).toBeTrue();
		expect(result.data.products!["gem-pack"]!.storePageEnabled).toBeFalse();
	});

	it.for([["isRegionalPricingEnabled"], ["storePageEnabled"]] as const)(
		"should reject a non-boolean %s on a root products entry and attribute the issue path to that field",
		([flag]) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					products: {
						"gem-pack": {
							name: "Gem Pack",
							description: "Stocks the player up with 1,000 premium gems.",
							[flag]: "yes",
						},
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["products", "gem-pack", flag]);
		},
	);

	it("should accept a root places collection that declares only filePath", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"start-place": { filePath: "places/start.rbxl" },
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.places!["start-place"]!.filePath).toBe("places/start.rbxl");
	});

	it("should reject a placeId declared on a root place entry and attribute the issue to that field", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"start-place": { filePath: "places/start.rbxl", placeId: "4711" },
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "start-place", "placeId"]);
	});

	it("should reject an undeclared field on a root place entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"start-place": {
						filePath: "places/start.rbxl",
						unexpected: "nope",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "start-place", "unexpected"]);
	});

	it.for([
		["trailing non-digits", "4711abc"],
		["leading non-digits", "abc4711"],
		["embedded non-digits", "47abc11"],
	] as const)("should reject an env-overlay placeId that has %s", ([, placeId]) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					production: {
						places: { "start-place": { placeId } },
					},
				},
				places: { "start-place": { filePath: "places/start.rbxl" } },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"production",
			"places",
			"start-place",
			"placeId",
		]);
	});

	it("should accept a root places entry that declares displayName, description, and serverSize", () => {
		expect.assertions(3);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"start-place": {
						description: "The lobby place.",
						displayName: "Start Place",
						filePath: "places/start.rbxl",
						serverSize: 50,
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.places!["start-place"]!.displayName).toBe("Start Place");
		expect(result.data.places!["start-place"]!.description).toBe("The lobby place.");
		expect(result.data.places!["start-place"]!.serverSize).toBe(50);
	});

	it.for([
		["a non-string displayName", { displayName: 42 }, "displayName"],
		["a non-string description", { description: 99 }, "description"],
		["a zero serverSize", { serverSize: 0 }, "serverSize"],
		["a negative serverSize", { serverSize: -10 }, "serverSize"],
		["a non-integer serverSize", { serverSize: 12.5 }, "serverSize"],
	] as const)("should reject %s on a root place entry", ([, override, expectedField]) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"start-place": { filePath: "places/start.rbxl", ...override },
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "start-place", expectedField]);
	});

	it("should accept a per-environment places overlay that declares displayName, description, and serverSize", () => {
		expect.assertions(3);

		const result = validateConfig(
			{
				environments: {
					staging: {
						places: {
							"start-place": {
								description: "Staging lobby.",
								displayName: "Staging Start",
								placeId: "5555",
								serverSize: 12,
							},
						},
					},
				},
				places: { "start-place": { filePath: "places/start.rbxl" } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		const overlay = result.data.environments["staging"]?.places?.["start-place"];

		expect(overlay?.displayName).toBe("Staging Start");
		expect(overlay?.description).toBe("Staging lobby.");
		expect(overlay?.serverSize).toBe(12);
	});

	it("should reject a non-positive serverSize on a per-environment places overlay", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: {
						places: {
							"start-place": { placeId: "5555", serverSize: 0 },
						},
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"staging",
			"places",
			"start-place",
			"serverSize",
		]);
	});

	it("should reject a places key that does not match the ResourceKey pattern", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"bad key!": { filePath: "places/start.rbxl" },
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "bad key!"]);
	});

	it("should accept a universe block declaring only universeId", () => {
		expect.assertions(2);

		const result = validateConfig(
			{ environments: MinEnvironments, universe: { universeId: "1234567890" } },
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe!.universeId).toBe("1234567890");
		expect(result.data.universe!.voiceChatEnabled).toBeUndefined();
	});

	it("should accept a universe block with voiceChatEnabled declared", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: { universeId: "1234567890", voiceChatEnabled: true },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe!.voiceChatEnabled).toBeTrue();
	});

	it.for(PLATFORM_FLAG_ROWS)("should accept a universe block with %s declared", ([flag]) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: { [flag]: false, universeId: "1234567890" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe![flag]).toBeFalse();
	});

	it.for(PLATFORM_FLAG_ROWS)(
		"should default %s to undefined when the universe block omits it",
		([flag]) => {
			expect.assertions(1);

			const result = validateConfig(
				{ environments: MinEnvironments, universe: { universeId: "1234567890" } },
				SOURCE,
			);

			assert(result.success);

			expect(result.data.universe![flag]).toBeUndefined();
		},
	);

	it.for(PLATFORM_FLAG_ROWS)("should reject a non-boolean %s on a universe block", ([flag]) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: { [flag]: "oops", universeId: "1234567890" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", flag]);
	});

	it("should accept a universe block with every platform flag declared", () => {
		expect.assertions(5);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: {
					consoleEnabled: false,
					desktopEnabled: true,
					mobileEnabled: false,
					tabletEnabled: true,
					universeId: "1234567890",
					vrEnabled: false,
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe!.desktopEnabled).toBeTrue();
		expect(result.data.universe!.mobileEnabled).toBeFalse();
		expect(result.data.universe!.tabletEnabled).toBeTrue();
		expect(result.data.universe!.consoleEnabled).toBeFalse();
		expect(result.data.universe!.vrEnabled).toBeFalse();
	});

	it("should reject a universe block missing universeId", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, universe: { voiceChatEnabled: true } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "universeId"]);
	});

	it.for([
		["trailing non-digits", "4711abc"],
		["leading non-digits", "abc4711"],
		["embedded non-digits", "47abc11"],
	] as const)("should reject a universe whose universeId has %s", ([, universeId]) => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, universe: { universeId } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "universeId"]);
	});

	it("should accept a universe block with all three optional managed fields declared", () => {
		expect.assertions(3);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: {
					displayName: "Fun Universe",
					privateServerPriceRobux: 250,
					universeId: "1234567890",
					voiceChatEnabled: true,
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe!.displayName).toBe("Fun Universe");
		expect(result.data.universe!.privateServerPriceRobux).toBe(250);
		expect(result.data.universe!.voiceChatEnabled).toBeTrue();
	});

	it("should preserve key-presence when privateServerPriceRobux is declared as undefined", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: {
					privateServerPriceRobux: undefined,
					universeId: "1234567890",
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect("privateServerPriceRobux" in result.data.universe!).toBeTrue();
		expect(result.data.universe!.privateServerPriceRobux).toBeUndefined();
	});

	it("should omit privateServerPriceRobux when the user does not declare it", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, universe: { universeId: "1234567890" } },
			SOURCE,
		);

		assert(result.success);

		expect("privateServerPriceRobux" in result.data.universe!).toBeFalse();
	});

	it("should reject a negative privateServerPriceRobux", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: { privateServerPriceRobux: -1, universeId: "1234567890" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "privateServerPriceRobux"]);
	});

	it("should reject a non-integer privateServerPriceRobux", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: { privateServerPriceRobux: 12.5, universeId: "1234567890" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "privateServerPriceRobux"]);
	});

	it("should reject an undeclared field on a universe block", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: { unexpected: "nope", universeId: "1234567890" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "unexpected"]);
	});

	it.for(SOCIAL_LINK_FIELDS)(
		"should accept a universe block with %s declared as a SocialLink object",
		(field) => {
			expect.assertions(2);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					universe: {
						[field]: { title: "Join us", uri: "https://example.com/x" },
						universeId: "1234567890",
					},
				},
				SOURCE,
			);

			assert(result.success);

			expect(result.data.universe).toContainKey(field);
			expect(result.data.universe![field]).toStrictEqual({
				title: "Join us",
				uri: "https://example.com/x",
			});
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should accept a universe block with %s declared as undefined and preserve the key",
		(field) => {
			expect.assertions(2);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					universe: { [field]: undefined, universeId: "1234567890" },
				},
				SOURCE,
			);

			assert(result.success);

			expect(result.data.universe).toContainKey(field);
			expect(result.data.universe![field]).toBeUndefined();
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should omit %s from validated data when the key is absent in the config",
		(field) => {
			expect.assertions(1);

			const result = validateConfig(
				{ environments: MinEnvironments, universe: { universeId: "1234567890" } },
				SOURCE,
			);

			assert(result.success);

			expect(result.data.universe).not.toContainKey(field);
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should reject a %s that is missing uri and attribute the issue path to the uri field",
		(field) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					universe: {
						[field]: { title: "Join us" },
						universeId: "1234567890",
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["universe", field, "uri"]);
		},
	);

	it.for(SOCIAL_LINK_FIELDS)("should reject an undeclared field inside a %s block", (field) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				universe: {
					[field]: { extra: 1, title: "Join us", uri: "https://example.com/x" },
					universeId: "1234567890",
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", field, "extra"]);
	});

	it("should accept a universe block with all seven social links declared together", () => {
		expect.assertions(7);

		const entry: Record<string, unknown> = { universeId: "1234567890" };
		for (const field of SOCIAL_LINK_FIELDS) {
			entry[field] = { title: `t-${field}`, uri: `https://example.com/${field}` };
		}

		const result = validateConfig({ environments: MinEnvironments, universe: entry }, SOURCE);
		assert(result.success);

		for (const field of SOCIAL_LINK_FIELDS) {
			expect(result.data.universe![field]).toStrictEqual({
				title: `t-${field}`,
				uri: `https://example.com/${field}`,
			});
		}
	});

	it("should accept environments[name].state with the same shape as root state", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					production: { state: { backend: "gist", gistId: "prod-gist" } },
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["production"]?.state).toContainEntry([
			"gistId",
			"prod-gist",
		]);
	});

	it("should accept a config that declares only environments[name].state and no root state", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					production: { state: { backend: "gist", gistId: "prod-gist" } },
					staging: { state: { backend: "gist", gistId: "staging-gist" } },
				},
			},
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it("should reject an environments key that does not match the environment-name pattern", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { "bad name!": {} },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["environments", "bad name!"]);
	});

	it("should reject an environments key that exceeds the 64-character length cap", () => {
		expect.assertions(1);

		const tooLong = "a".repeat(65);
		const result = validateConfig({ environments: { [tooLong]: {} } }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["environments", tooLong]);
	});

	it("should accept a per-environment universe overlay declaring universeId when no root universe block exists", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					production: { universe: { universeId: "9999999999" } },
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["production"]?.universe?.universeId).toBe("9999999999");
	});

	it("should accept a per-environment universe overlay declaring universeId when the root universe block carries shared fields without universeId", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: {
					production: { universe: { universeId: "9999999999" } },
					staging: { universe: { universeId: "5555555555" } },
				},
				state: { backend: "gist", gistId: "root-gist" },
				universe: { desktopEnabled: true, voiceChatEnabled: true },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe?.desktopEnabled).toBeTrue();
		expect(result.data.environments["production"]?.universe?.universeId).toBe("9999999999");
	});

	it("should reject a per-environment universe overlay missing universeId when no root universeId is declared", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					production: { universe: { voiceChatEnabled: true } },
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"production",
			"universe",
			"universeId",
		]);
	});

	it("should reject a config that declares universeId at the root and on a per-environment overlay", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					production: { universe: { universeId: "9999999999" } },
				},
				state: { backend: "gist", gistId: "root-gist" },
				universe: { universeId: "1111111111" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"production",
			"universe",
			"universeId",
		]);
	});

	it("should reject a root universe block missing universeId when no environment supplies one", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: { production: {} },
				state: { backend: "gist", gistId: "root-gist" },
				universe: { desktopEnabled: true },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "universeId"]);
		expect(result.err.issues[0]!.message).toContain(
			"universeId must be declared on the root universe block",
		);
	});

	it("should accept a config where root has universeId and an env declares a universe overlay carrying only shared fields", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					production: { universe: { voiceChatEnabled: false } },
				},
				state: { backend: "gist", gistId: "root-gist" },
				universe: { universeId: "1234567890", voiceChatEnabled: true },
			},
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it("should accept a config where root has universeId and one env supplies its own while another only carries shared fields", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: {
					production: { universe: { voiceChatEnabled: false } },
					staging: {},
				},
				state: { backend: "gist", gistId: "root-gist" },
				universe: { universeId: "1234567890" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe?.universeId).toBe("1234567890");
		expect(result.data.environments["production"]?.universe?.voiceChatEnabled).toBeFalse();
	});

	it("should attribute the both-set rejection to the offending env's universeId path with a descriptive message", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: { production: { universe: { universeId: "9999999999" } } },
				state: { backend: "gist", gistId: "root-gist" },
				universe: { universeId: "1111111111" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"production",
			"universe",
			"universeId",
		]);
		expect(result.err.issues[0]!.message).toContain(
			"universeId is declared at the root universe block",
		);
	});

	it("should attribute the missing-env-universeId rejection with a descriptive message naming the root-must-supply requirement", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: { production: { universe: { voiceChatEnabled: true } } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"production",
			"universe",
			"universeId",
		]);
		expect(result.err.issues[0]!.message).toContain("root universe block does not provide one");
	});

	it("should accept a config where the root carries shared universe fields without universeId, one env supplies its own, and another env omits the universe overlay entirely", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: {
					production: { universe: { universeId: "9999999999" } },
					staging: {},
				},
				state: { backend: "gist", gistId: "root-gist" },
				universe: { desktopEnabled: true },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe?.desktopEnabled).toBeTrue();
		expect(result.data.environments["production"]?.universe?.universeId).toBe("9999999999");
	});

	it("should reject a config where one env supplies universeId and another env declares a universe overlay without one", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: {
					production: { universe: { universeId: "9999999999" } },
					staging: { universe: { voiceChatEnabled: true } },
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"staging",
			"universe",
			"universeId",
		]);
		expect(result.err.issues[0]!.message).toContain("root universe block does not provide one");
	});

	it("should accept a per-environment places overlay that declares placeId without filePath", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: {
						places: {
							"start-place": { placeId: "5555" },
						},
					},
				},
				places: { "start-place": { filePath: "places/start.rbxl" } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["staging"]?.places?.["start-place"]?.placeId).toBe("5555");
	});

	it("should reject a per-environment places overlay entry that omits placeId", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: {
						places: {
							"start-place": { filePath: "places/start-staging.rbxl" },
						},
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"staging",
			"places",
			"start-place",
			"placeId",
		]);
	});

	it("should accept a per-environment passes overlay that omits every field as a no-op", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: { passes: { "vip-pass": {} } },
				},
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip.png" },
						price: 500,
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it.for([
		["true", true],
		["false", false],
	] as const)(
		"should accept a per-environment passes overlay that declares redacted: %s",
		([, redacted]) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: {
						staging: { passes: { "vip-pass": { redacted } } },
					},
					passes: {
						"vip-pass": {
							name: "VIP Pass",
							description: "Grants VIP perks.",
							icon: { "en-us": "assets/vip.png" },
							price: 500,
						},
					},
					state: { backend: "gist", gistId: "root-gist" },
				},
				SOURCE,
			);

			assert(result.success);

			expect(result.data.environments["staging"]?.passes?.["vip-pass"]?.redacted).toBe(
				redacted,
			);
		},
	);

	it("should reject an object override form on a per-environment passes overlay redacted field", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: {
						passes: { "vip-pass": { redacted: { name: "Closed Beta" } } },
					},
				},
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip.png" },
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"staging",
			"passes",
			"vip-pass",
			"redacted",
		]);
	});

	it("should accept a per-environment products overlay that supplies a partial subset of fields", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: { products: { "gem-pack": { name: "Staging Gem Pack" } } },
				},
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["staging"]?.products?.["gem-pack"]?.name).toBe(
			"Staging Gem Pack",
		);
	});

	it("should accept a per-environment products overlay that declares a price", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: {
						products: {
							"gem-pack": { name: "Gem Pack", price: 100 },
						},
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["staging"]?.products?.["gem-pack"]?.price).toBe(100);
	});

	it.for(INVALID_ROBUX_PRICES)(
		"should reject %s as a per-environment products overlay price",
		([, price]) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: {
						staging: { products: { "gem-pack": { price } } },
					},
					state: { backend: "gist", gistId: "root-gist" },
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual([
				"environments",
				"staging",
				"products",
				"gem-pack",
				"price",
			]);
		},
	);

	it("should accept a per-environment products overlay that declares isRegionalPricingEnabled and storePageEnabled", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: {
					staging: {
						products: {
							"gem-pack": {
								isRegionalPricingEnabled: true,
								storePageEnabled: false,
							},
						},
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(
			result.data.environments["staging"]?.products?.["gem-pack"]?.isRegionalPricingEnabled,
		).toBeTrue();
		expect(
			result.data.environments["staging"]?.products?.["gem-pack"]?.storePageEnabled,
		).toBeFalse();
	});

	it("should reject an undeclared field inside a per-environment products overlay entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: {
						products: {
							"gem-pack": { name: "Gem Pack", isForSale: true },
						},
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"staging",
			"products",
			"gem-pack",
			"isForSale",
		]);
	});

	it("should reject a per-environment products overlay key that does not match the ResourceKey pattern", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: {
						products: { "bad key!": { name: "Bad" } },
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"staging",
			"products",
			"bad key!",
		]);
	});

	it.for(INVALID_ROBUX_PRICES)(
		"should reject %s as a per-environment passes overlay price",
		([, price]) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: {
						staging: { passes: { "vip-pass": { price } } },
					},
					state: { backend: "gist", gistId: "root-gist" },
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual([
				"environments",
				"staging",
				"passes",
				"vip-pass",
				"price",
			]);
		},
	);

	it("should accept a per-environment passes overlay that supplies a partial subset of fields", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: { passes: { "vip-pass": { price: 250 } } },
				},
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip.png" },
						price: 500,
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["staging"]?.passes?.["vip-pass"]?.price).toBe(250);
	});

	it("should reject an undeclared field inside a per-environment places overlay entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					staging: {
						places: {
							"start-place": { placeId: "5555", unexpected: "nope" },
						},
					},
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"staging",
			"places",
			"start-place",
			"unexpected",
		]);
	});

	it("should reject an undeclared field on an environments entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { production: { unexpected: 1 } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"production",
			"unexpected",
		]);
	});

	it.for([
		["true", true],
		["false", false],
	] as const)("should accept a bare redacted: %s on an environments entry", ([, redacted]) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { production: { redacted } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["production"]?.redacted).toBe(redacted);
	});

	it("should reject an object-form redacted on an environments entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { production: { redacted: { name: "Closed Beta" } } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"production",
			"redacted",
		]);
	});

	it("should accept a config whose root state declares backend gist with a gistId", () => {
		expect.assertions(2);

		const result = validateConfig(
			{ environments: MinEnvironments, state: { backend: "gist", gistId: "abc123def456" } },
			SOURCE,
		);

		assert(result.success);

		expect(result.data.state).toContainEntry(["backend", "gist"]);
		expect(result.data.state).toContainEntry(["gistId", "abc123def456"]);
	});

	it("should reject a state block missing the backend field and attribute the issue path to backend", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, state: { gistId: "abc123" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "backend"]);
	});

	it("should reject a gist state block whose gistId is the empty string", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, state: { backend: "gist", gistId: "" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "gistId"]);
	});

	it("should accept a state block whose backend is an unrecognized string at the runtime layer", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, state: { backend: "future-backend" } },
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it("should reject an undeclared field on a state block", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				state: { backend: "gist", gistId: "abc123", unexpected: "nope" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "unexpected"]);
	});

	it("should accept a non-empty string label on an environment entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { staging: { label: "Staging" } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["staging"]?.label).toBe("Staging");
	});

	it("should reject a non-string label on an environment entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { staging: { label: 42 } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["environments", "staging", "label"]);
	});

	it("should accept a displayNamePrefix block declaring enabled and format together", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				displayNamePrefix: { enabled: false, format: "<{label}> " },
				environments: MinEnvironments,
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.displayNamePrefix?.enabled).toBeFalse();
		expect(result.data.displayNamePrefix?.format).toBe("<{label}> ");
	});

	it("should reject a non-boolean enabled on displayNamePrefix", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				displayNamePrefix: { enabled: "yes" },
				environments: MinEnvironments,
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["displayNamePrefix", "enabled"]);
	});

	it("should reject a non-string format on displayNamePrefix", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				displayNamePrefix: { format: 42 },
				environments: MinEnvironments,
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["displayNamePrefix", "format"]);
	});

	it("should reject an undeclared field on displayNamePrefix", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				displayNamePrefix: { unexpected: 1 },
				environments: MinEnvironments,
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["displayNamePrefix", "unexpected"]);
	});

	it("should accumulate every validation issue with its own attributed field path", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: 42,
						description: "Two bad fields.",
						icon: { "en-us": "assets/vip.png" },
						price: "oops",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues.map((issue) => issue.path)).toStrictEqual([
			["passes", "vip-pass", "name"],
			["passes", "vip-pass", "price"],
		]);
	});
});
