import {
	developerProductCurrent,
	developerProductDesired,
	INVALID_ROBUX_PRICES,
	ValidDeveloperProductEntry,
} from "#tests/helpers/resources";
import { ArkErrors } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { asResourceKey } from "../../types/ids.ts";
import { developerProductKind } from "./developer-product.ts";

describe("developerProductKind", () => {
	it("should tag its kind discriminator as developerProduct", () => {
		expect.assertions(1);

		expect(developerProductKind.kind).toBe("developerProduct");
	});

	describe("entrySchema", () => {
		it("should accept a valid entry that omits price", () => {
			expect.assertions(1);

			expect(developerProductKind.entrySchema(ValidDeveloperProductEntry)).not.toBeInstanceOf(
				ArkErrors,
			);
		});

		it("should accept a valid entry with a non-negative integer price", () => {
			expect.assertions(1);

			expect(
				developerProductKind.entrySchema({ ...ValidDeveloperProductEntry, price: 100 }),
			).not.toBeInstanceOf(ArkErrors);
		});

		it.for(INVALID_ROBUX_PRICES)("should reject %s as a price", ([, price]) => {
			expect.assertions(1);

			expect(
				developerProductKind.entrySchema({ ...ValidDeveloperProductEntry, price }),
			).toBeInstanceOf(ArkErrors);
		});
	});

	describe("flatten", () => {
		it("should emit a tagged input per entry in config.products", () => {
			expect.assertions(1);

			expect(
				developerProductKind.flatten({
					environments: { production: {} },
					products: {
						"gem-pack": {
							name: "Gem Pack",
							description: "Stocks the player up with 1,000 premium gems.",
							price: 100,
						},
					},
				}),
			).toStrictEqual([
				{
					key: asResourceKey("gem-pack"),
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					kind: "developerProduct",
					price: 100,
				},
			]);
		});

		it("should pass price through as undefined when the entry omits it", () => {
			expect.assertions(1);

			expect(
				developerProductKind.flatten({
					environments: { production: {} },
					products: {
						"gem-pack": {
							name: "Gem Pack",
							description: "Stocks the player up with 1,000 premium gems.",
						},
					},
				}),
			).toStrictEqual([
				{
					key: asResourceKey("gem-pack"),
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					kind: "developerProduct",
					price: undefined,
				},
			]);
		});

		it("should emit an empty list when the config has no products", () => {
			expect.assertions(1);

			expect(developerProductKind.flatten({ environments: { production: {} } })).toBeEmpty();
		});

		it("should preserve the insertion order of config.products entries", () => {
			expect.assertions(1);

			const inputs = developerProductKind.flatten({
				environments: { production: {} },
				products: {
					"coin-pack": { name: "Coin", description: "c" },
					"gem-pack": { name: "Gem", description: "g" },
				},
			});

			expect(inputs.map((input) => input.key)).toStrictEqual([
				asResourceKey("coin-pack"),
				asResourceKey("gem-pack"),
			]);
		});
	});

	describe("normalize", () => {
		it("should pass the input fields through onto the desired state", async () => {
			expect.assertions(1);

			const result = await developerProductKind.normalize(
				{
					key: asResourceKey("gem-pack"),
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					kind: "developerProduct",
					price: 100,
				},
				{ readFile: async () => new Uint8Array() },
			);

			assert(result.success);

			expect(result.data).toStrictEqual({
				key: asResourceKey("gem-pack"),
				name: "Gem Pack",
				description: "Stocks the player up with 1,000 premium gems.",
				kind: "developerProduct",
				price: 100,
			});
		});

		it("should pass an undefined price through to the desired state", async () => {
			expect.assertions(1);

			const result = await developerProductKind.normalize(
				{
					key: asResourceKey("gem-pack"),
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					kind: "developerProduct",
					price: undefined,
				},
				{ readFile: async () => new Uint8Array() },
			);

			assert(result.success);

			expect(result.data.price).toBeUndefined();
		});
	});

	describe("fieldsEqual", () => {
		it("should return true when every managed field matches", () => {
			expect.assertions(1);

			expect(
				developerProductKind.fieldsEqual(
					developerProductDesired(),
					developerProductCurrent(),
				),
			).toBeTrue();
		});

		it.for<[label: string, currentOverrides: Partial<ResourceCurrentStateDeveloperProduct>]>([
			["name", { name: "Other Name" }],
			["description", { description: "Other description" }],
			["price (undefined to defined)", { price: 100 }],
		])("should return false when %s differs", ([, overrides]) => {
			expect.assertions(1);

			expect(
				developerProductKind.fieldsEqual(
					developerProductDesired(),
					developerProductCurrent(overrides),
				),
			).toBeFalse();
		});

		it("should return false when price differs from defined to undefined", () => {
			expect.assertions(1);

			expect(
				developerProductKind.fieldsEqual(
					developerProductDesired({ price: undefined }),
					developerProductCurrent({ price: 100 }),
				),
			).toBeFalse();
		});

		it("should return false when both prices are defined but different", () => {
			expect.assertions(1);

			expect(
				developerProductKind.fieldsEqual(
					developerProductDesired({ price: 100 }),
					developerProductCurrent({ price: 200 }),
				),
			).toBeFalse();
		});

		it("should return true when both prices are the same defined value", () => {
			expect.assertions(1);

			expect(
				developerProductKind.fieldsEqual(
					developerProductDesired({ price: 100 }),
					developerProductCurrent({ price: 100 }),
				),
			).toBeTrue();
		});
	});
});

type ResourceCurrentStateDeveloperProduct = Parameters<typeof developerProductKind.fieldsEqual>[1];
