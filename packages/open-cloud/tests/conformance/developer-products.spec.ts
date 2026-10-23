import { assert, describe, it } from "vitest";

import {
	buildCreateRequest,
	buildUpdateRequest,
} from "#src/domains/developer-products/products/builders";
import { parseDeveloperProductResponse } from "#src/domains/developer-products/products/parsers";
import {
	expectValid,
	getOpenApiDocument,
	getValidator,
	isRecord,
	loadFixture,
} from "./_helpers.ts";

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

		it("should round-trip create-response.json mapping null priceInformation and iconImageAssetId to undefined", ({
			expect,
		}) => {
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
				isManagedPricingEnabled: false,
				price: undefined,
				universeId: "4567890123",
				updatedAt: new Date("2024-12-20T12:00:00.000Z"),
			});
		});
	});
});

describe("developer-products multipart bodies", () => {
	it("should send only create fields the create endpoint declares", ({ expect }) => {
		expect.assertions(1);

		const request = buildCreateRequest({
			name: "Gem Pack",
			isManagedPricingEnabled: true,
			universeId: "67890",
		});

		assert(request.body instanceof FormData);

		expect(
			listMultipartProperties(
				"/developer-products/v2/universes/{universeId}/developer-products",
				"post",
			),
		).toIncludeAllMembers([...request.body.keys()]);
	});

	it("should send only update fields the update endpoint declares", ({ expect }) => {
		expect.assertions(1);

		const request = buildUpdateRequest({
			isManagedPricingEnabled: false,
			productId: "12345",
			universeId: "67890",
		});

		assert(request.body instanceof FormData);

		expect(
			listMultipartProperties(
				"/developer-products/v2/universes/{universeId}/developer-products/{productId}",
				"patch",
			),
		).toIncludeAllMembers([...request.body.keys()]);
	});
});

function listMultipartProperties(route: string, method: "patch" | "post"): ReadonlyArray<string> {
	const { paths } = getOpenApiDocument();
	assert(isRecord(paths));
	const path = paths[route];
	assert(isRecord(path));
	const operation = path[method];
	assert(isRecord(operation));
	const { requestBody } = operation;
	assert(isRecord(requestBody));
	const { content } = requestBody;
	assert(isRecord(content));
	const multipart = content["multipart/form-data"];
	assert(isRecord(multipart));
	const { schema } = multipart;
	assert(isRecord(schema));
	const { properties } = schema;
	assert(isRecord(properties));
	return Object.keys(properties);
}
