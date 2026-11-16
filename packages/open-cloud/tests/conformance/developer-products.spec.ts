import { assert, describe, it } from "vitest";

import {
	buildCreateRequest,
	buildUpdateRequest,
} from "#src/domains/developer-products/products/builders";
import { parseDeveloperProductResponse } from "#src/domains/developer-products/products/parsers";
import { expectValid, getValidator, listMultipartProperties, loadFixture } from "./_helpers.ts";

describe("developer-products fixtures", () => {
	it.for([
		{ fixture: "get-response.json", schema: "DeveloperProductConfigV2" },
		{ fixture: "create-response.json", schema: "DeveloperProductConfigV2" },
	])("should validate $fixture against $schema", ({ fixture, schema }, { expect }) => {
		expect.assertions(1);

		const validator = getValidator(schema);
		const body = loadFixture("developer-products", fixture);

		expectValid(expect, { fixture: body, validator });
	});

	describe(parseDeveloperProductResponse, () => {
		it("should round-trip get-response.json into the public DeveloperProduct shape", ({
			expect,
		}) => {
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
				isManagedPricingEnabled: false,
				price: {
					defaultPriceInRobux: 99,
					enabledFeatures: ["RegionalPricing"],
				},
				universeId: "4567890123",
				updatedAt: new Date("2024-09-14T05:33:10.250Z"),
			});
		});

		// create-response.json was captured on 2026-11-16 from a live create
		// with no imageFile and no price. Product id, universe id, name and
		// description are scrubbed. A create with no icon returns Roblox's
		// default icon id, not null.
		it("should round-trip create-response.json mapping null priceInformation to undefined and keeping the default icon id", ({
			expect,
		}) => {
			expect.assertions(1);

			const body = loadFixture("developer-products", "create-response.json");

			const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data).toStrictEqual({
				id: "91827364",
				name: "Starter Boost",
				createdAt: new Date("2026-11-16T00:14:14.831Z"),
				description: "First-time buyer welcome bundle.",
				iconImageAssetId: "88963008124478",
				isForSale: false,
				isImmutable: false,
				isManagedPricingEnabled: false,
				price: undefined,
				universeId: "4567890123",
				updatedAt: new Date("2026-11-16T00:14:14.831Z"),
			});
		});
	});
});

describe("developer-products multipart bodies", () => {
	it("should send is-managed-pricing-enabled on create as a declared multipart field", ({
		expect,
	}) => {
		expect.assertions(2);

		const request = buildCreateRequest({
			name: "Gem Pack",
			isManagedPricingEnabled: true,
			universeId: "67890",
		});

		assert(request.body instanceof FormData);

		expect(request.body.get("isManagedPricingEnabled")).toBe("true");
		expect(
			listMultipartProperties(
				"/developer-products/v2/universes/{universeId}/developer-products",
				"post",
			),
		).toIncludeAllMembers([...request.body.keys()]);
	});

	it("should send is-managed-pricing-enabled on update as a declared multipart field", ({
		expect,
	}) => {
		expect.assertions(2);

		const request = buildUpdateRequest({
			isManagedPricingEnabled: false,
			productId: "12345",
			universeId: "67890",
		});

		assert(request.body instanceof FormData);

		expect(request.body.get("isManagedPricingEnabled")).toBe("false");
		expect(
			listMultipartProperties(
				"/developer-products/v2/universes/{universeId}/developer-products/{productId}",
				"patch",
			),
		).toIncludeAllMembers([...request.body.keys()]);
	});
});
