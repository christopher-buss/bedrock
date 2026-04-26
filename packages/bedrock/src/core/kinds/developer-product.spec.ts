import { developerProductCurrent, developerProductDesired } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { asResourceKey } from "../../types/ids.ts";
import { developerProductKind } from "./developer-product.ts";

describe("developerProductKind", () => {
	it("should tag its kind discriminator as developerProduct", () => {
		expect.assertions(1);

		expect(developerProductKind.kind).toBe("developerProduct");
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
						},
					},
				}),
			).toStrictEqual([
				{
					key: asResourceKey("gem-pack"),
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					kind: "developerProduct",
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
				},
				{ readFile: async () => new Uint8Array() },
			);

			assert(result.success);

			expect(result.data).toStrictEqual({
				key: asResourceKey("gem-pack"),
				name: "Gem Pack",
				description: "Stocks the player up with 1,000 premium gems.",
				kind: "developerProduct",
			});
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
		])("should return false when %s differs", ([, overrides]) => {
			expect.assertions(1);

			expect(
				developerProductKind.fieldsEqual(
					developerProductDesired(),
					developerProductCurrent(overrides),
				),
			).toBeFalse();
		});
	});
});

type ResourceCurrentStateDeveloperProduct = Parameters<typeof developerProductKind.fieldsEqual>[1];
