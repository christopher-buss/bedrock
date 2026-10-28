import { type } from "arktype";
import { assert, describe, it } from "vitest";

import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import { INVALID_ROBUX_PRICES, PLATFORM_FLAG_ROWS } from "#tests/helpers/resources";
import { SOCIAL_LINK_FIELDS } from "./resources.ts";
import { createConfigValidator, parseStateConfig, validateConfig } from "./schema.ts";

const SOURCE = "bedrock.config.ts";

const MinEnvironments = { production: {} } as const;

const S3_REGISTRY = fakeStateBackendPlugins({
	name: "s3",
	createPort: () => ({ err: { reason: "unused in schema tests" }, success: false }),
	schema: type({ "bucket": "string > 0", "region?": "string" }),
	specifier: "@example/state-s3",
});

const validateWithS3 = createConfigValidator(S3_REGISTRY);

class OpaqueBackendOptions {
	readonly #value = "retained";

	public read(): string {
		return this.#value;
	}
}

describe(validateConfig, () => {
	it("should copy cyclic declarative containers while retaining authored accessors", ({
		expect,
	}) => {
		expect.assertions(3);

		const values: Record<string, unknown> = { labels: ["one"] };
		values["self"] = values;
		const registry = fakeStateBackendPlugins({
			name: "cycle",
			createPort: () => ({ err: { reason: "unused" }, success: false }),
			schema: type({ values: "unknown" }),
			specifier: "@example/cycle",
		});
		const input = {
			get environments() {
				return MinEnvironments;
			},
			plugins: ["@example/cycle"],
			state: { backend: "cycle", values },
		};
		const result = createConfigValidator(registry)(input, SOURCE);
		assert(result.success);
		const received = result.data.state;
		assert(received !== undefined && "values" in received);
		const copied = received["values"];
		assert(copied instanceof Object && "self" in copied);

		expect(copied).not.toBe(values);
		expect(copied.self).toBe(copied);
		expect(result.data.plugins).not.toBe(input.plugins);
	});

	it("should retain opaque backend callbacks and object prototypes when copying resource data", ({
		expect,
	}) => {
		expect.assertions(3);

		function callback(): string {
			return "retained";
		}

		const opaque = new OpaqueBackendOptions();
		const registry = fakeStateBackendPlugins({
			name: "opaque",
			createPort: () => ({ err: { reason: "unused" }, success: false }),
			schema: type({ callback: "Function", opaque: "object" }),
			specifier: "@example/opaque",
		});
		const result = createConfigValidator(registry)(
			{ environments: MinEnvironments, state: { backend: "opaque", callback, opaque } },
			SOURCE,
		);
		assert(result.success);

		expect(result.data.state).toHaveProperty("callback", callback);

		const received = result.data.state;
		assert(received !== undefined && "opaque" in received);

		expect(received["opaque"]).toBe(opaque);

		assert(received["opaque"] instanceof OpaqueBackendOptions);

		expect(received["opaque"].read()).toBe("retained");
	});

	it("should return independent resource data without mutating authored configuration", ({
		expect,
	}) => {
		expect.assertions(1);

		const input = {
			environments: { production: {} },
			passes: {
				vip: {
					name: "VIP",
					description: "Perks",
					icon: { "en-us": "vip.png" },
					price: 500,
				},
			},
		};
		const result = validateConfig(input, SOURCE);
		assert(result.success);
		result.data.passes!["vip"]!.price = 9999;

		expect(input.passes.vip.price).toBe(500);
	});

	it("should reject a config missing the required environments collection", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig({}, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["environments"]);
	});

	it("should reject a config whose environments collection is empty", ({ expect }) => {
		expect.assertions(2);

		const result = validateConfig({ environments: {} }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["environments"]);
		expect(result.err.issues[0]!.message).toContain(
			"environments record with at least one declared environment",
		);
	});

	it("should accept a minimal config that declares only environments", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig({ environments: MinEnvironments }, SOURCE);

		assert(result.success);

		expect(result.data.environments).toContainKey("production");
	});

	it("should accept the reserved extends key at the root", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, extends: "./base.config.ts" },
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it("should accept a codegen section with enable and output fields", ({ expect }) => {
		expect.assertions(2);

		const result = validateConfig(
			{ codegen: { enabled: true, output: "src/generated" }, environments: MinEnvironments },
			SOURCE,
		);

		assert(result.success);

		expect(result.data.codegen!.enabled).toBeTrue();
		expect(result.data.codegen!.output).toBe("src/generated");
	});

	it("should accept a codegen section that omits both optional fields", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig({ codegen: {}, environments: MinEnvironments }, SOURCE);

		expect(result.success).toBeTrue();
	});

	it("should accept a codegen section that opts into type declarations", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{ codegen: { enabled: true, typeDeclarations: true }, environments: MinEnvironments },
			SOURCE,
		);

		assert(result.success);

		expect(result.data.codegen!.typeDeclarations).toBeTrue();
	});

	it("should reject a non-boolean codegen type-declarations flag", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{ codegen: { typeDeclarations: "yes" }, environments: MinEnvironments },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["codegen", "typeDeclarations"]);
	});

	it("should reject an unknown key inside the codegen section", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{ codegen: { language: "luau" }, environments: MinEnvironments },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["codegen", "language"]);
	});

	it("should reject a non-boolean codegen enable flag", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{ codegen: { enabled: "yes" }, environments: MinEnvironments },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["codegen", "enabled"]);
	});

	it("should reject unknown top-level keys and point the issue path at the offending key", ({
		expect,
	}) => {
		expect.assertions(3);

		const result = validateConfig({ environments: MinEnvironments, unexpected: {} }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.sourceFile).toBe(SOURCE);
		expect(result.err.issues).toHaveLength(1);
		expect(result.err.issues[0]!.path).toStrictEqual(["unexpected"]);
	});

	it("should accept a passes collection with a valid game-pass entry", ({ expect }) => {
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

	it("should default price to undefined when omitted on a passes entry", ({ expect }) => {
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

	it("should reject a passes key that does not match the ResourceKey pattern and attribute the issue path to that key", ({
		expect,
	}) => {
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

	it("should reject a passes entry missing a required icon field and attribute the issue path to that field", ({
		expect,
	}) => {
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

	it("should reject a passes icon map declaring a locale other than 'en-us'", ({ expect }) => {
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

	it("should reject a passes icon map missing the 'en-us' key", ({ expect }) => {
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

	it("should reject a wrongly-typed field and attribute the issue path to that field", ({
		expect,
	}) => {
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
		([, price], { expect }) => {
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
	] as const)("should accept a passes entry with redacted: %s", ([, redacted], { expect }) => {
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
		["partial price override", { price: 500 }],
		[
			"full override",
			{
				name: "Closed Beta",
				description: "Coming soon.",
				icon: { "en-us": "assets/closed-beta.png" },
				price: 500,
			},
		],
	] as const)(
		"should accept a passes entry with redacted as the %s object form",
		([, redacted], { expect }) => {
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

	it("should default redacted to undefined when omitted on a passes entry", ({ expect }) => {
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
		([, redacted], { expect }) => {
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

	it("should reject an empty redacted object and recommend redacted: true for default placeholders", ({
		expect,
	}) => {
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

	it("should reject an unknown key in a redacted override and attribute the issue path to the offending key", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip.png" },
						redacted: { bogus: "value" },
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
			"bogus",
		]);
		expect(result.err.issues[0]!.message).toContain("bogus");
	});

	it.for([
		["negative", -1],
		["fractional", 1.5],
		["NaN", NaN],
		["Infinity", Infinity],
	] as const)(
		"should reject %s as a redacted price override on a passes entry",
		([, price], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					passes: {
						"vip-pass": {
							name: "VIP Pass",
							description: "Grants VIP perks.",
							icon: { "en-us": "assets/vip.png" },
							redacted: { price },
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
		},
	);

	it("should accept zero as a redacted price override on a passes entry", ({ expect }) => {
		expect.assertions(1);

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

		assert(result.success);

		expect(result.data.passes!["vip-pass"]!.redacted).toStrictEqual({ price: 0 });
	});

	it("should accept a products collection with a valid developer-product entry", ({ expect }) => {
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

	it("should reject a products key that does not match the ResourceKey pattern and attribute the issue path to that key", ({
		expect,
	}) => {
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

	it("should reject a products entry missing a required field and attribute the issue path to that field", ({
		expect,
	}) => {
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

	it("should accept a products entry that declares an optional price", ({ expect }) => {
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

	it("should reject a wrongly-typed price on a root products entry", ({ expect }) => {
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
		([, price], { expect }) => {
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

	it.for([
		{
			collection: "passes",
			overlay: { name: "VIP" },
			root: { retired: true },
		},
		{
			collection: "products",
			overlay: { description: "Gems" },
			root: { retired: "untrack" },
		},
		{
			collection: "places",
			overlay: { placeId: "4711" },
			root: { retired: true },
		},
	] as const)(
		"should reject $collection overlay fields under a retired root entry",
		({ collection, overlay, root }, { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					[collection]: { item: root },
					environments: { production: { [collection]: { item: overlay } } },
				},
				SOURCE,
			);

			assert(!result.success && result.err.kind === "validationFailed");

			expect(result.err.issues).toStrictEqual([
				{
					message: `${collection}.item is retired at the root, so environment "production" may only set retired on it.`,
					path: ["environments", "production", collection, "item"],
				},
			]);
		},
	);

	it("should accept a retired overlay under a retired root entry", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { production: { passes: { item: { retired: "untrack" } } } },
				passes: { item: { retired: true } },
			},
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it("should reject an undeclared field on a root products entry", ({ expect }) => {
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

	it.for([
		["isRegionalPricingEnabled", "managed pricing"],
		["storePageEnabled", "Shop listing"],
	] as const)(
		"should reject the retired %s field on a root products entry with a message naming its replacement",
		([field, replacement], { expect }) => {
			expect.assertions(2);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					products: {
						"gem-pack": {
							name: "Gem Pack",
							description: "Stocks the player up with 1,000 premium gems.",
							[field]: true,
						},
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["products", "gem-pack", field]);
			expect(result.err.issues[0]!.message).toBe(
				`${field} is no longer supported: Roblox retired it on 2026-07-20 (${replacement} replaces it). Remove this field.`,
			);
		},
	);

	it.for([
		["true", true],
		["false", false],
	] as const)("should accept a products entry with redacted: %s", ([, redacted], { expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						redacted,
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.products!["gem-pack"]!.redacted).toBe(redacted);
	});

	it("should default redacted to undefined when omitted on a products entry", ({ expect }) => {
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

		expect(result.data.products!["gem-pack"]!.redacted).toBeUndefined();
	});

	it.for([
		["string", "true"],
		["number", 1],
		// eslint-disable-next-line unicorn/no-null -- testing that arktype rejects the json null literal
		["null", null],
	] as const)(
		"should reject %s as a products redacted field and attribute the issue path to that field",
		([, redacted], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					products: {
						"gem-pack": {
							name: "Gem Pack",
							description: "Stocks the player up with 1,000 premium gems.",
							redacted,
						},
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["products", "gem-pack", "redacted"]);
		},
	);

	it.for([
		["partial name override", { name: "Closed Beta Pack" }],
		["partial description override", { description: "Coming soon." }],
		["partial icon override", { icon: { "en-us": "assets/closed-beta.png" } }],
		["partial price override", { price: 500 }],
		[
			"full override",
			{
				name: "Closed Beta Pack",
				description: "Coming soon.",
				icon: { "en-us": "assets/closed-beta.png" },
				price: 500,
			},
		],
	] as const)(
		"should accept a products entry with redacted as the %s object form",
		([, redacted], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					products: {
						"gem-pack": {
							name: "Gem Pack",
							description: "Stocks the player up with 1,000 premium gems.",
							redacted,
						},
					},
				},
				SOURCE,
			);

			assert(result.success);

			expect(result.data.products!["gem-pack"]!.redacted).toStrictEqual(redacted);
		},
	);

	it("should reject an empty redacted object on a products entry and recommend redacted: true for default placeholders", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						redacted: {},
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["products", "gem-pack", "redacted"]);
		expect(result.err.issues[0]!.message).toContain("redacted: true");
	});

	it("should reject an unknown key in a products redacted override and attribute the issue path to the offending key", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						redacted: { bogus: "value" },
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"products",
			"gem-pack",
			"redacted",
			"bogus",
		]);
		expect(result.err.issues[0]!.message).toContain("bogus");
	});

	it.for([
		["negative", -1],
		["fractional", 1.5],
		["NaN", NaN],
		["Infinity", Infinity],
	] as const)(
		"should reject %s as a redacted price override on a products entry",
		([, price], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					products: {
						"gem-pack": {
							name: "Gem Pack",
							description: "Stocks the player up with 1,000 premium gems.",
							redacted: { price },
						},
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual([
				"products",
				"gem-pack",
				"redacted",
				"price",
			]);
		},
	);

	it("should accept zero as a redacted price override on a products entry", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						redacted: { price: 0 },
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.products!["gem-pack"]!.redacted).toStrictEqual({ price: 0 });
	});

	it("should accept a root places collection that declares only filePath", ({ expect }) => {
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

	it("should accept a root place entry that omits filePath", ({ expect }) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"start-place": { displayName: "Start Place", serverSize: 50 },
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.places!["start-place"]!.filePath).toBeUndefined();
		expect(result.data.places!["start-place"]!.displayName).toBe("Start Place");
	});

	it("should reject a placeId declared on a root place entry and attribute the issue to that field", ({
		expect,
	}) => {
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

	it("should reject an undeclared field on a root place entry", ({ expect }) => {
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
	] as const)("should reject an env-overlay placeId that has %s", ([, placeId], { expect }) => {
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

	it("should accept a root places entry that declares displayName, description, and serverSize", ({
		expect,
	}) => {
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
	] as const)(
		"should reject %s on a root place entry",
		([, override, expectedField], { expect }) => {
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

			expect(result.err.issues[0]!.path).toStrictEqual([
				"places",
				"start-place",
				expectedField,
			]);
		},
	);

	it("should accept a per-environment places overlay that declares displayName, description, and serverSize", ({
		expect,
	}) => {
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

		const overlay = result.data.environments["staging"]!.places!["start-place"];

		expect(overlay!.displayName).toBe("Staging Start");
		expect(overlay!.description).toBe("Staging lobby.");
		expect(overlay!.serverSize).toBe(12);
	});

	it("should reject a non-positive serverSize on a per-environment places overlay", ({
		expect,
	}) => {
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

	it("should reject a places key that does not match the ResourceKey pattern", ({ expect }) => {
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

	it.for([
		["true", true],
		["false", false],
	] as const)("should accept a places entry with redacted: %s", ([, redacted], { expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"start-place": {
						filePath: "places/start.rbxl",
						redacted,
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.places!["start-place"]!.redacted).toBe(redacted);
	});

	it.for([
		["partial description override", { description: "Coming soon." }],
		["partial displayName override", { displayName: "Hidden Project" }],
		["full override", { description: "Coming soon.", displayName: "Hidden Project" }],
	] as const)(
		"should accept a places entry with redacted as the %s object form",
		([, redacted], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					places: {
						"start-place": {
							filePath: "places/start.rbxl",
							redacted,
						},
					},
				},
				SOURCE,
			);

			assert(result.success);

			expect(result.data.places!["start-place"]!.redacted).toStrictEqual(redacted);
		},
	);

	it("should default redacted to undefined when omitted on a places entry", ({ expect }) => {
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

		expect(result.data.places!["start-place"]!.redacted).toBeUndefined();
	});

	it.for([
		["string", "true"],
		["number", 1],
		// eslint-disable-next-line unicorn/no-null -- testing that arktype rejects the json null literal
		["null", null],
	] as const)(
		"should reject %s as a places redacted field and attribute the issue path to that field",
		([, redacted], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					places: {
						"start-place": {
							filePath: "places/start.rbxl",
							redacted,
						},
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["places", "start-place", "redacted"]);
		},
	);

	it("should reject an empty places redacted object and recommend redacted: true for default placeholders", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"start-place": {
						filePath: "places/start.rbxl",
						redacted: {},
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "start-place", "redacted"]);
		expect(result.err.issues[0]!.message).toContain("redacted: true");
	});

	it("should reject an unknown key in a places redacted override and attribute the issue path to the offending key", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				places: {
					"start-place": {
						filePath: "places/start.rbxl",
						redacted: { filePath: "nope" },
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"places",
			"start-place",
			"redacted",
			"filePath",
		]);
		expect(result.err.issues[0]!.message).toContain("filePath");
	});

	it("should accept a universe block declaring only universeId", ({ expect }) => {
		expect.assertions(2);

		const result = validateConfig(
			{ environments: MinEnvironments, universe: { universeId: "1234567890" } },
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe!.universeId).toBe("1234567890");
		expect(result.data.universe!.voiceChatEnabled).toBeUndefined();
	});

	it("should accept a universe block with voiceChatEnabled declared", ({ expect }) => {
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

	it.for(PLATFORM_FLAG_ROWS)(
		"should accept a universe block with %s declared",
		([flag], { expect }) => {
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
		},
	);

	it.for(PLATFORM_FLAG_ROWS)(
		"should default %s to undefined when the universe block omits it",
		([flag], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{ environments: MinEnvironments, universe: { universeId: "1234567890" } },
				SOURCE,
			);

			assert(result.success);

			expect(result.data.universe![flag]).toBeUndefined();
		},
	);

	it.for(PLATFORM_FLAG_ROWS)(
		"should reject a non-boolean %s on a universe block",
		([flag], { expect }) => {
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
		},
	);

	it("should accept a universe block with every platform flag declared", ({ expect }) => {
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

	it("should reject a universe block missing universeId", ({ expect }) => {
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
	] as const)(
		"should reject a universe whose universeId has %s",
		([, universeId], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{ environments: MinEnvironments, universe: { universeId } },
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["universe", "universeId"]);
		},
	);

	it("should accept a universe block with all three optional managed fields declared", ({
		expect,
	}) => {
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

	it("should reject privateServerPriceRobux declared as undefined", ({ expect }) => {
		expect.assertions(1);

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

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "privateServerPriceRobux"]);
	});

	it("should omit privateServerPriceRobux when the user does not declare it", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, universe: { universeId: "1234567890" } },
			SOURCE,
		);

		assert(result.success);

		expect("privateServerPriceRobux" in result.data.universe!).toBeFalse();
	});

	it("should reject a negative privateServerPriceRobux", ({ expect }) => {
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

	it("should reject a non-integer privateServerPriceRobux", ({ expect }) => {
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

	it("should reject an undeclared field on a universe block", ({ expect }) => {
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
		(field, { expect }) => {
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
		"should reject a universe block with %s declared as undefined",
		(field, { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: MinEnvironments,
					universe: { [field]: undefined, universeId: "1234567890" },
				},
				SOURCE,
			);

			expect(result.success).toBeFalse();
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should omit %s from validated data when the key is absent in the config",
		(field, { expect }) => {
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
		(field, { expect }) => {
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

	it.for(SOCIAL_LINK_FIELDS)(
		"should reject an undeclared field inside a %s block",
		(field, { expect }) => {
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
		},
	);

	it("should accept a universe block with all seven social links declared together", ({
		expect,
	}) => {
		expect.assertions(1);

		const links = Object.fromEntries(
			SOCIAL_LINK_FIELDS.map((field) => [
				field,
				{ title: `t-${field}`, uri: `https://example.com/${field}` },
			]),
		);
		const result = validateConfig(
			{ environments: MinEnvironments, universe: { ...links, universeId: "1234567890" } },
			SOURCE,
		);
		assert(result.success);

		expect(SOCIAL_LINK_FIELDS.map((field) => result.data.universe![field])).toStrictEqual(
			SOCIAL_LINK_FIELDS.map((field) => links[field]),
		);
	});

	it("should accept locking turned off on a builtin backend", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: MinEnvironments,
				state: { backend: "gist", gistId: "root-gist", locking: false },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.state).toContainEntry(["locking", false]);
	});

	it("should accept environments[name].state with the same shape as root state", ({ expect }) => {
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

		expect(result.data.environments["production"]!.state).toContainEntry([
			"gistId",
			"prod-gist",
		]);
	});

	it("should accept a config that declares only environments[name].state and no root state", ({
		expect,
	}) => {
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

	it("should reject an environments key that does not match the environment-name pattern", ({
		expect,
	}) => {
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

	it("should reject an environments key that exceeds the 64-character length cap", ({
		expect,
	}) => {
		expect.assertions(1);

		const tooLong = "a".repeat(65);
		const result = validateConfig({ environments: { [tooLong]: {} } }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["environments", tooLong]);
	});

	it("should accept a per-environment universe overlay declaring universeId when no root universe block exists", ({
		expect,
	}) => {
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

		expect(result.data.environments["production"]!.universe!.universeId).toBe("9999999999");
	});

	it("should accept a per-environment universe overlay declaring universeId when the root universe block carries shared fields without universeId", ({
		expect,
	}) => {
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

		expect(result.data.universe!.desktopEnabled).toBeTrue();
		expect(result.data.environments["production"]!.universe!.universeId).toBe("9999999999");
	});

	it("should reject a per-environment universe overlay missing universeId when no root universeId is declared", ({
		expect,
	}) => {
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

	it("should reject a config that declares universeId at the root and on a per-environment overlay", ({
		expect,
	}) => {
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

	it("should reject a root universe block missing universeId when no environment supplies one", ({
		expect,
	}) => {
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

	it("should accept a config where root has universeId and an env declares a universe overlay carrying only shared fields", ({
		expect,
	}) => {
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

	it("should accept a config where root has universeId and one env supplies its own while another only carries shared fields", ({
		expect,
	}) => {
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

		expect(result.data.universe!.universeId).toBe("1234567890");
		expect(result.data.environments["production"]!.universe!.voiceChatEnabled).toBeFalse();
	});

	it("should attribute the both-set rejection to the offending env's universeId path with a descriptive message", ({
		expect,
	}) => {
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

	it("should attribute the missing-env-universeId rejection with a descriptive message naming the root-must-supply requirement", ({
		expect,
	}) => {
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

	it("should accept a config where the root carries shared universe fields without universeId, one env supplies its own, and another env omits the universe overlay entirely", ({
		expect,
	}) => {
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

		expect(result.data.universe!.desktopEnabled).toBeTrue();
		expect(result.data.environments["production"]!.universe!.universeId).toBe("9999999999");
	});

	it("should reject a config where one env supplies universeId and another env declares a universe overlay without one", ({
		expect,
	}) => {
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

	it("should accept a per-environment places overlay that declares placeId without filePath", ({
		expect,
	}) => {
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

		expect(result.data.environments["staging"]!.places!["start-place"]!.placeId).toBe("5555");
	});

	it("should reject a per-environment places overlay entry that omits placeId", ({ expect }) => {
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

	it("should accept a per-environment passes overlay that omits every field as a no-op", ({
		expect,
	}) => {
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
		([, redacted], { expect }) => {
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

			expect(result.data.environments["staging"]!.passes!["vip-pass"]!.redacted).toBe(
				redacted,
			);
		},
	);

	it("should accept an object override form on a per-environment passes overlay redacted field", ({
		expect,
	}) => {
		expect.assertions(1);

		const override = { name: "Closed Beta", price: 1 };
		const result = validateConfig(
			{
				environments: {
					staging: {
						passes: { "vip-pass": { redacted: override } },
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

		assert(result.success);

		expect(result.data.environments["staging"]!.passes!["vip-pass"]!.redacted).toStrictEqual(
			override,
		);
	});

	it("should reject an empty object on a per-environment passes overlay redacted field", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: {
					staging: { passes: { "vip-pass": { redacted: {} } } },
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
		expect(result.err.issues[0]!.message).toContain("redacted: true");
	});

	it.for([
		["true", true],
		["false", false],
	] as const)(
		"should accept a per-environment places overlay that declares redacted: %s",
		([, redacted], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: {
						staging: { places: { "start-place": { placeId: "5555", redacted } } },
					},
					places: { "start-place": { filePath: "places/start.rbxl" } },
					state: { backend: "gist", gistId: "root-gist" },
				},
				SOURCE,
			);

			assert(result.success);

			expect(result.data.environments["staging"]!.places!["start-place"]!.redacted).toBe(
				redacted,
			);
		},
	);

	it("should accept an object override form on a per-environment places overlay redacted field", ({
		expect,
	}) => {
		expect.assertions(1);

		const override = { displayName: "Hidden Project" };
		const result = validateConfig(
			{
				environments: {
					staging: {
						places: {
							"start-place": {
								placeId: "5555",
								redacted: override,
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

		expect(result.data.environments["staging"]!.places!["start-place"]!.redacted).toStrictEqual(
			override,
		);
	});

	it("should reject an empty object on a per-environment places overlay redacted field", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: {
					staging: {
						places: { "start-place": { placeId: "5555", redacted: {} } },
					},
				},
				places: { "start-place": { filePath: "places/start.rbxl" } },
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
			"redacted",
		]);
		expect(result.err.issues[0]!.message).toContain("redacted: true");
	});

	it("should accept a per-environment products overlay that supplies a partial subset of fields", ({
		expect,
	}) => {
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

		expect(result.data.environments["staging"]!.products!["gem-pack"]!.name).toBe(
			"Staging Gem Pack",
		);
	});

	it("should accept a per-environment products overlay that declares a price", ({ expect }) => {
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

		expect(result.data.environments["staging"]!.products!["gem-pack"]!.price).toBe(100);
	});

	it.for(INVALID_ROBUX_PRICES)(
		"should reject %s as a per-environment products overlay price",
		([, price], { expect }) => {
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

	it.for([
		["isRegionalPricingEnabled", "managed pricing"],
		["storePageEnabled", "Shop listing"],
	] as const)(
		"should reject the retired %s field on a per-environment products overlay with a message naming its replacement",
		([field, replacement], { expect }) => {
			expect.assertions(2);

			const result = validateConfig(
				{
					environments: {
						staging: { products: { "gem-pack": { [field]: false } } },
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
				field,
			]);
			expect(result.err.issues[0]!.message).toBe(
				`${field} is no longer supported: Roblox retired it on 2026-07-20 (${replacement} replaces it). Remove this field.`,
			);
		},
	);

	it("should reject an undeclared field inside a per-environment products overlay entry", ({
		expect,
	}) => {
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

	it("should reject a per-environment products overlay key that does not match the ResourceKey pattern", ({
		expect,
	}) => {
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

	it.for([
		["true", true],
		["false", false],
	] as const)(
		"should accept a per-environment products overlay that declares redacted: %s",
		([, redacted], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: {
						staging: { products: { "gem-pack": { redacted } } },
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

			expect(result.data.environments["staging"]!.products!["gem-pack"]!.redacted).toBe(
				redacted,
			);
		},
	);

	it("should accept an object override form on a per-environment products overlay redacted field", ({
		expect,
	}) => {
		expect.assertions(1);

		const override = { name: "Closed Beta Pack", price: 1 };
		const result = validateConfig(
			{
				environments: {
					staging: {
						products: { "gem-pack": { redacted: override } },
					},
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

		expect(result.data.environments["staging"]!.products!["gem-pack"]!.redacted).toStrictEqual(
			override,
		);
	});

	it("should reject an empty object on a per-environment products overlay redacted field", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: {
					staging: {
						products: { "gem-pack": { redacted: {} } },
					},
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

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"staging",
			"products",
			"gem-pack",
			"redacted",
		]);
		expect(result.err.issues[0]!.message).toContain("redacted: true");
	});

	it.for(INVALID_ROBUX_PRICES)(
		"should reject %s as a per-environment passes overlay price",
		([, price], { expect }) => {
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

	it("should accept a per-environment passes overlay that supplies a partial subset of fields", ({
		expect,
	}) => {
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

		expect(result.data.environments["staging"]!.passes!["vip-pass"]!.price).toBe(250);
	});

	it("should reject an undeclared field inside a per-environment places overlay entry", ({
		expect,
	}) => {
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

	it("should reject an undeclared field on an environments entry", ({ expect }) => {
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
	] as const)(
		"should accept a bare redacted: %s on an environments entry",
		([, redacted], { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: { production: { redacted } },
					state: { backend: "gist", gistId: "root-gist" },
				},
				SOURCE,
			);

			assert(result.success);

			expect(result.data.environments["production"]!.redacted).toBe(redacted);
		},
	);

	it("should accept an object-form redacted on an environments entry that carries the cross-kind union of override fields", ({
		expect,
	}) => {
		expect.assertions(1);

		const override = {
			name: "Closed Beta",
			description: "Reveal at launch.",
			displayName: "Hidden Project",
			icon: { "en-us": "assets/redacted.png" },
			price: 1,
		};

		const result = validateConfig(
			{
				environments: { production: { redacted: override } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["production"]!.redacted).toStrictEqual(override);
	});

	it("should reject an empty redacted override on an environments entry and recommend redacted: true for default placeholders", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{
				environments: { production: { redacted: {} } },
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
		expect(result.err.issues[0]!.message).toContain("redacted: true");
	});

	it("should reject an unknown key on an env-level redacted override and attribute the issue to the offending key", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { production: { redacted: { bogus: "value" } } },
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
			"bogus",
		]);
	});

	it("should accept a config whose root state declares backend gist with a gistId", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = validateConfig(
			{ environments: MinEnvironments, state: { backend: "gist", gistId: "abc123def456" } },
			SOURCE,
		);

		assert(result.success);

		expect(result.data.state).toContainEntry(["backend", "gist"]);
		expect(result.data.state).toContainEntry(["gistId", "abc123def456"]);
	});

	it("should reject a state block missing the backend field and attribute the issue path to backend", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, state: { gistId: "abc123" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "backend"]);
	});

	it("should reject a gist state block whose gistId is the empty string", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, state: { backend: "gist", gistId: "" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "gistId"]);
	});

	it("should accept a state block whose backend is an unrecognized string at the runtime layer", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = validateConfig(
			{ environments: MinEnvironments, state: { backend: "future-backend" } },
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it("should reject an undeclared field on a state block", ({ expect }) => {
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

	it("should accept a non-empty string label on an environment entry", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { staging: { label: "Staging" } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments["staging"]!.label).toBe("Staging");
	});

	it("should reject a non-string label on an environment entry", ({ expect }) => {
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

	it("should accept a displayNamePrefix block declaring enabled and format together", ({
		expect,
	}) => {
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

		expect(result.data.displayNamePrefix!.enabled).toBeFalse();
		expect(result.data.displayNamePrefix!.format).toBe("<{label}> ");
	});

	it("should reject a non-boolean enabled on displayNamePrefix", ({ expect }) => {
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

	it("should reject a non-string format on displayNamePrefix", ({ expect }) => {
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

	it("should reject an undeclared field on displayNamePrefix", ({ expect }) => {
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

	it("should accumulate every validation issue with its own attributed field path", ({
		expect,
	}) => {
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

describe(createConfigValidator, () => {
	it("should accept the custom state keys a plugin's backend declared", ({ expect }) => {
		expect.assertions(1);

		const result = validateWithS3(
			{
				environments: MinEnvironments,
				state: { backend: "s3", bucket: "my-bucket", region: "eu-west-2" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.state).toContainEntry(["bucket", "my-bucket"]);
	});

	it("should accept a plugin-declared backend on a per-environment state block", ({ expect }) => {
		expect.assertions(1);

		const result = validateWithS3(
			{
				environments: { production: { state: { backend: "s3", bucket: "prod-bucket" } } },
			},
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it("should attribute an invalid value for a plugin's own state key to that field", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = validateWithS3(
			{ environments: MinEnvironments, state: { backend: "s3", bucket: "" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "bucket"]);
	});

	it("should reject a state key that neither the plugin nor core declared", ({ expect }) => {
		expect.assertions(1);

		const result = validateWithS3(
			{
				environments: MinEnvironments,
				state: { backend: "s3", bucket: "my-bucket", endpoint: "https://example.invalid" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "endpoint"]);
	});

	it("should reject a gist key on a plugin-declared backend the plugin did not declare", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = validateWithS3(
			{
				environments: MinEnvironments,
				state: { backend: "s3", bucket: "my-bucket", gistId: "abc123" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "gistId"]);
	});

	it("should accept locking turned off on a plugin-declared backend", ({ expect }) => {
		expect.assertions(1);

		const result = validateWithS3(
			{
				environments: MinEnvironments,
				state: { backend: "s3", bucket: "my-bucket", locking: false },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.state).toContainEntry(["locking", false]);
	});

	it("should reject a locking value that is not a boolean", ({ expect }) => {
		expect.assertions(1);

		const result = validateWithS3(
			{
				environments: MinEnvironments,
				state: { backend: "s3", bucket: "my-bucket", locking: "off" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "locking"]);
	});

	it("should still reject a plugin's own keys on a backend name the plugin did not claim", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = validateWithS3(
			{
				environments: MinEnvironments,
				state: { backend: "gist", bucket: "my-bucket" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "bucket"]);
	});
});

describe(parseStateConfig, () => {
	it("should return the block a plugin backend's schema accepts", ({ expect }) => {
		expect.assertions(1);

		const parsed = parseStateConfig({ backend: "s3", bucket: "my-state" }, S3_REGISTRY);

		assert(parsed.success);

		expect(parsed.data).toStrictEqual({ backend: "s3", bucket: "my-state" });
	});

	it("should attribute a key the backend's schema rejects to the key itself", ({ expect }) => {
		expect.assertions(2);

		const parsed = parseStateConfig({ backend: "s3", bucket: "" }, S3_REGISTRY);

		assert(!parsed.success);

		expect(parsed.err[0]!.path).toStrictEqual(["bucket"]);
		expect(parsed.err[0]!.message).toBeString();
	});

	it("should reject a key the backend never declared", ({ expect }) => {
		expect.assertions(1);

		const parsed = parseStateConfig(
			{ backend: "s3", bucket: "my-state", nonsense: "x" },
			S3_REGISTRY,
		);

		assert(!parsed.success);

		expect(parsed.err[0]!.path).toStrictEqual(["nonsense"]);
	});

	it("should report every key a backend requires and the block omits", ({ expect }) => {
		expect.assertions(1);

		const parsed = parseStateConfig({ backend: "s3" }, S3_REGISTRY);

		assert(!parsed.success);

		expect(parsed.err[0]!.path).toStrictEqual(["bucket"]);
	});

	it("should accept the builtin gist block against a registry that never claimed it", ({
		expect,
	}) => {
		expect.assertions(1);

		const parsed = parseStateConfig({ backend: "gist", gistId: "abc123" }, S3_REGISTRY);

		assert(parsed.success);

		expect(parsed.data).toStrictEqual({ backend: "gist", gistId: "abc123" });
	});
});

describe("none sentinel", () => {
	const pass = { name: "VIP", description: "d", icon: { "en-us": "vip.png" } };
	const product = { name: "Gems", description: "d" };

	const accepted: ReadonlyArray<readonly [string, object, object]> = [
		["root pass price", { passes: { vip: { ...pass, price: "$none" } } }, {}],
		[
			"overlay pass price",
			{ passes: { vip: { ...pass, price: 1 } } },
			{ passes: { vip: { price: "$none" } } },
		],
		["root product price", { products: { gems: { ...product, price: "$none" } } }, {}],
		[
			"overlay product price",
			{ products: { gems: product } },
			{ products: { gems: { price: "$none" } } },
		],
		[
			"root private-server price",
			{ universe: { privateServerPriceRobux: "$none", universeId: "1" } },
			{},
		],
		[
			"overlay private-server price",
			{ universe: { universeId: "1" } },
			{ universe: { privateServerPriceRobux: "$none" } },
		],
		["root social link", { universe: { discordSocialLink: "$none", universeId: "1" } }, {}],
		[
			"overlay social link",
			{ universe: { universeId: "1" } },
			{ universe: { youtubeSocialLink: "$none" } },
		],
	];

	it.for(accepted)("should accept none on a %s", ([, root, overlay], { expect }) => {
		expect.assertions(1);

		const result = validateConfig({ ...root, environments: { production: overlay } }, SOURCE);

		expect(result.success).toBeTrue();
	});

	const rejected: ReadonlyArray<readonly [string, object]> = [
		["universe boolean flag", { universe: { universeId: "1", voiceChatEnabled: "$none" } }],
		["universe display name", { universe: { displayName: "$none", universeId: "1" } }],
		["place description", { places: { start: { description: "$none" } } }],
		["place display name", { places: { start: { displayName: "$none" } } }],
		["pass name", { passes: { vip: { ...pass, name: "$none" } } }],
		["product description", { products: { gems: { ...product, description: "$none" } } }],
		["redacted price override", { passes: { vip: { ...pass, redacted: { price: "$none" } } } }],
		["redacted pass name", { passes: { vip: { ...pass, redacted: { name: "$none" } } } }],
		[
			"redacted product description",
			{ products: { gems: { ...product, redacted: { description: "$none" } } } },
		],
		[
			"redacted place display name",
			{ places: { start: { redacted: { displayName: "$none" } } } },
		],
		[
			"redacted environment name",
			{ environments: { production: { redacted: { name: "$none" } } } },
		],
	];

	it.for(rejected)("should reject none on a %s", ([, root], { expect }) => {
		expect.assertions(1);

		const result = validateConfig({ environments: { production: {} }, ...root }, SOURCE);

		expect(result.success).toBeFalse();
	});

	it("should explain that a text field does not accept none", ({ expect }) => {
		expect.assertions(2);

		const result = validateConfig(
			{ environments: { production: {} }, places: { start: { description: "$none" } } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "start", "description"]);
		expect(result.err.issues[0]!.message).toContain("text other than $none");
	});
});

describe("present undefined on a resource field", () => {
	const pass = { name: "VIP", description: "d", icon: { "en-us": "vip.png" } };
	const product = { name: "Gems", description: "d" };

	const rejected: ReadonlyArray<readonly [string, object, object]> = [
		["root pass price", { passes: { vip: { ...pass, price: undefined } } }, {}],
		["root pass redacted", { passes: { vip: { ...pass, redacted: undefined } } }, {}],
		[
			"pass redacted override",
			{ passes: { vip: { ...pass, redacted: { name: undefined } } } },
			{},
		],
		[
			"pass redacted price override",
			{ passes: { vip: { ...pass, redacted: { price: undefined } } } },
			{},
		],
		[
			"product redacted price override",
			{ products: { gems: { ...product, redacted: { price: undefined } } } },
			{},
		],
		[
			"place redacted override",
			{ places: { start: { redacted: { displayName: undefined } } } },
			{},
		],
		["environment redacted price override", {}, { redacted: { price: undefined } }],
		[
			"overlay pass price",
			{ passes: { vip: pass } },
			{ passes: { vip: { price: undefined } } },
		],
		["root product price", { products: { gems: { ...product, price: undefined } } }, {}],
		[
			"overlay product price",
			{ products: { gems: product } },
			{ products: { gems: { price: undefined } } },
		],
		["root place server size", { places: { start: { serverSize: undefined } } }, {}],
		["root place file path", { places: { start: { filePath: undefined } } }, {}],
		[
			"overlay place description",
			{ places: { start: {} } },
			{ places: { start: { description: undefined, placeId: "1" } } },
		],
		["root universe flag", { universe: { universeId: "1", voiceChatEnabled: undefined } }, {}],
		[
			"overlay universe display name",
			{ universe: { universeId: "1" } },
			{ universe: { displayName: undefined } },
		],
	];

	it.for(rejected)("should reject undefined on a %s", ([, root, overlay], { expect }) => {
		expect.assertions(1);

		const result = validateConfig({ ...root, environments: { production: overlay } }, SOURCE);

		expect(result.success).toBeFalse();
	});

	it("should keep accepting undefined outside the resource sections", ({ expect }) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				codegen: { enabled: undefined },
				environments: { production: { label: undefined, redacted: undefined } },
			},
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});
});
