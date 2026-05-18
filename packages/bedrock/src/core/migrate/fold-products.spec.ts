import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asSha256Hex } from "../../types/ids.ts";
import { foldProducts } from "./fold-products.ts";
import type { MantleResource } from "./types.ts";

const SAMPLE_HASH = "86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1";

interface ProductFixture {
	readonly inputs: unknown;
	readonly outputs: unknown;
}

function product(key: string, payload: ProductFixture): MantleResource {
	return {
		key,
		dependencies: [],
		inputs: payload.inputs,
		kind: "product",
		outputs: payload.outputs,
	};
}

function productIcon(key: string, payload: ProductFixture): MantleResource {
	return {
		key,
		dependencies: [],
		inputs: payload.inputs,
		kind: "productIcon",
		outputs: payload.outputs,
	};
}

function onSaleInputs(): Record<string, unknown> {
	return {
		name: "Example Product",
		description: "This is an example product.",
		price: 5,
	};
}

function productOutputs(): Record<string, unknown> {
	return { assetId: 1835296153, productId: 58109926 };
}

function productIconInputs(): Record<string, unknown> {
	return {
		fileHash: SAMPLE_HASH,
		filePath: "assets/marketing/example-icon.png",
	};
}

function productIconOutputs(): Record<string, unknown> {
	return { assetId: 18280868488 };
}

function fixture(inputs?: unknown, outputs?: unknown): ProductFixture {
	return {
		inputs: inputs === undefined ? onSaleInputs() : inputs,
		outputs: outputs === undefined ? productOutputs() : outputs,
	};
}

function iconFixture(inputs?: unknown, outputs?: unknown): ProductFixture {
	return {
		inputs: inputs === undefined ? productIconInputs() : inputs,
		outputs: outputs === undefined ? productIconOutputs() : outputs,
	};
}

describe(foldProducts, () => {
	it("should fold a well-formed product resource into one entry", () => {
		expect.assertions(4);

		const result = foldProducts([product("1-example", fixture())]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.key).toBe(asResourceKey("1-example"));
		expect(entry.mantlePath).toBe("product_1-example");
		expect(entry.entry).toStrictEqual({
			name: "Example Product",
			description: "This is an example product.",
			price: 5,
		});
		expect(entry.outputs).toStrictEqual({
			iconImageAssetId: undefined,
			productId: "1835296153",
		});
	});

	it("should preserve price when set to a positive integer", () => {
		expect.assertions(1);

		const inputs = onSaleInputs();
		inputs["price"] = 250;

		const result = foldProducts([product("1-example", fixture(inputs))]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.entry.price).toBe(250);
	});

	it("should treat null price as off-sale (undefined)", () => {
		expect.assertions(1);

		const inputs = onSaleInputs();
		// Mantle YAML emits `price: ~` for off-sale products, which the parser
		// surfaces as a literal `null` in the wire payload before this fold runs.
		// eslint-disable-next-line unicorn/no-null -- exercise the wire-data null path
		inputs["price"] = null;

		const result = foldProducts([product("1-example", fixture(inputs))]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.entry).toStrictEqual({
			name: "Example Product",
			description: "This is an example product.",
		});
	});

	it("should treat missing price as off-sale (undefined)", () => {
		expect.assertions(1);

		const inputs = onSaleInputs();
		delete inputs["price"];

		const result = foldProducts([product("1-example", fixture(inputs))]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.entry).toStrictEqual({
			name: "Example Product",
			description: "This is an example product.",
		});
	});

	it("should ignore non-product resource kinds", () => {
		expect.assertions(1);

		const result = foldProducts([
			{
				key: "1-spurious",
				dependencies: [],
				inputs: onSaleInputs(),
				kind: "pass",
				outputs: productOutputs(),
			},
		]);

		expect(result.products).toStrictEqual([]);
	});

	it("should drop a product resource missing required string fields", () => {
		expect.assertions(2);

		const noName = onSaleInputs();
		delete noName["name"];
		const noDescription = onSaleInputs();
		delete noDescription["description"];

		expect(foldProducts([product("1-example", fixture(noName))]).products).toStrictEqual([]);
		expect(foldProducts([product("1-example", fixture(noDescription))]).products).toStrictEqual(
			[],
		);
	});

	it("should drop a product resource without outputs.assetId", () => {
		expect.assertions(1);

		const result = foldProducts([
			product("1-example", fixture(undefined, { productId: 58109926 })),
		]);

		expect(result.products).toStrictEqual([]);
	});

	it("should map mantle outputs.assetId (not outputs.productId) to the bedrock productId", () => {
		expect.assertions(1);

		// Mantle's `assetId` is the canonical marketplace id (what
		// MarketplaceService.PromptProductPurchase and Open Cloud's URL accept);
		// Mantle's `productId` is a legacy config id Open Cloud v2 cannot route.
		// Distinct values prove a future re-swap would surface here.
		const result = foldProducts([
			product("1-example", fixture(undefined, { assetId: 100, productId: 200 })),
		]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.outputs.productId).toBe("100");
	});

	it("should drop a product whose inputs payload is not an object", () => {
		expect.assertions(3);

		// eslint-disable-next-line unicorn/no-null -- exercising the null branch of the defensive guard
		expect(foldProducts([product("1-example", fixture(null))]).products).toStrictEqual([]);
		expect(foldProducts([product("1-example", fixture([]))]).products).toStrictEqual([]);
		expect(
			foldProducts([product("1-example", fixture("not-an-object"))]).products,
		).toStrictEqual([]);
	});

	it("should drop a product whose outputs payload is not an object", () => {
		expect.assertions(1);

		// eslint-disable-next-line unicorn/no-null -- exercising the null branch of the defensive guard
		const result = foldProducts([product("1-example", fixture(undefined, null))]);

		expect(result.products).toStrictEqual([]);
	});

	it("should accept a string-formatted assetId in the outputs", () => {
		expect.assertions(1);

		const result = foldProducts([
			product(
				"1-example",
				fixture(undefined, { assetId: "1835296153", productId: "58109926" }),
			),
		]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.outputs.productId).toBe("1835296153");
	});

	it("should pair a productIcon resource with its product by key", () => {
		expect.assertions(3);

		const result = foldProducts([
			product("1-example", fixture()),
			productIcon("1-example", iconFixture()),
		]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.entry.icon).toStrictEqual({
			"en-us": "assets/marketing/example-icon.png",
		});
		expect(entry.outputs.iconImageAssetId).toBe("18280868488");
		expect(result.warnings).toStrictEqual([]);
	});

	it("should preserve the mantle-recorded icon file hash on the fold entry", () => {
		expect.assertions(1);

		const result = foldProducts([
			product("1-example", fixture()),
			productIcon("1-example", iconFixture()),
		]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.mantleIconFileHashes).toStrictEqual({ "en-us": asSha256Hex(SAMPLE_HASH) });
	});

	it("should fold a product without a productIcon as an entry without icon fields", () => {
		expect.assertions(3);

		const result = foldProducts([product("1-example", fixture())]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.entry.icon).toBeNil();
		expect(entry.outputs.iconImageAssetId).toBeNil();
		expect(entry.mantleIconFileHashes).toBeNil();
	});

	it("should emit an ambiguous warning for an orphan productIcon resource", () => {
		expect.assertions(2);

		const result = foldProducts([productIcon("1-example", iconFixture())]);

		expect(result.products).toStrictEqual([]);
		expect(result.warnings).toStrictEqual([
			{
				hint: "Verify your Mantle state file: each productIcon_<k> resource must be paired with a matching product_<k>.",
				kind: "ambiguous",
				mantlePath: "productIcon_1-example",
			},
		]);
	});

	it("should drop a productIcon resource with a malformed file hash", () => {
		expect.assertions(3);

		const malformedInputs = productIconInputs();
		malformedInputs["fileHash"] = "not-a-real-hash";

		const result = foldProducts([
			product("1-example", fixture()),
			productIcon("1-example", iconFixture(malformedInputs)),
		]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.entry.icon).toBeNil();
		expect(entry.outputs.iconImageAssetId).toBeNil();
		expect(entry.mantleIconFileHashes).toBeNil();
	});
});
