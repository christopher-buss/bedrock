import { assert, describe, expect, it } from "vitest";

import { asResourceKey } from "../../types/ids.ts";
import { foldProducts } from "./fold-products.ts";
import type { MantleResource } from "./types.ts";

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

function fixture(inputs?: unknown, outputs?: unknown): ProductFixture {
	return {
		inputs: inputs === undefined ? onSaleInputs() : inputs,
		outputs: outputs === undefined ? productOutputs() : outputs,
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
		expect(entry.outputs).toStrictEqual({ productId: "58109926" });
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
		inputs["price"] = undefined;

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

	it("should drop a product resource without outputs.productId", () => {
		expect.assertions(1);

		const result = foldProducts([
			product("1-example", fixture(undefined, { assetId: 1835296153 })),
		]);

		expect(result.products).toStrictEqual([]);
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

	it("should accept a string-formatted productId in the outputs", () => {
		expect.assertions(1);

		const result = foldProducts([
			product(
				"1-example",
				fixture(undefined, { assetId: "1835296153", productId: "58109926" }),
			),
		]);
		const [entry] = result.products;
		assert(entry !== undefined);

		expect(entry.outputs.productId).toBe("58109926");
	});
});
