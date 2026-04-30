import { parseDeveloperProductResponse } from "#src/domains/developer-products/products/parsers";
import { assert, describe, expect, it } from "vitest";

import { expectValid, getValidator, loadFixture } from "./_helpers.ts";

describe("developer-products fixtures", () => {
	it.for([
		{ fixture: "get-response.json", schema: "DeveloperProductConfigV2" },
		{ fixture: "create-response.json", schema: "DeveloperProductConfigV2" },
	])("should validate $fixture against $schema", ({ fixture, schema }) => {
		expect.assertions(1);

		const validator = getValidator(schema);
		const body = loadFixture("developer-products", fixture);

		expectValid(validator, body);
	});

	describe(parseDeveloperProductResponse, () => {
		it("should round-trip get-response.json into the public DeveloperProduct shape", () => {
			expect.assertions(1);

			const body = loadFixture("developer-products", "get-response.json");

			const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data).toStrictEqual({
				id: "81726354",
				name: "Premium Gem Pack",
				createdAt: new Date("2023-07-22T11:48:03.000Z"),
				description: "Stocks the player up with 1,000 premium gems.",
				iconImageAssetId: "14502339875",
				isForSale: true,
				isImmutable: false,
				price: {
					defaultPriceInRobux: 99,
					enabledFeatures: ["RegionalPricing"],
				},
				storePageEnabled: true,
				universeId: "4567890123",
				updatedAt: new Date("2024-09-14T05:33:10.250Z"),
			});
		});

		it("should round-trip create-response.json mapping null priceInformation and iconImageAssetId to undefined", () => {
			expect.assertions(1);

			const body = loadFixture("developer-products", "create-response.json");

			const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data).toStrictEqual({
				id: "91827364",
				name: "Starter Boost",
				createdAt: new Date("2024-12-20T12:00:00.000Z"),
				description: "First-time buyer welcome bundle.",
				iconImageAssetId: undefined,
				isForSale: false,
				isImmutable: false,
				price: undefined,
				storePageEnabled: false,
				universeId: "4567890123",
				updatedAt: new Date("2024-12-20T12:00:00.000Z"),
			});
		});
	});
});
