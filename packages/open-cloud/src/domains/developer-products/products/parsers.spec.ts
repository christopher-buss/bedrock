import { validDeveloperProductBody } from "#tests/helpers/developer-products";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseDeveloperProductResponse } from "./parsers.ts";
import type { DeveloperProductConfigV2 } from "./wire.ts";

describe(parseDeveloperProductResponse, () => {
	it("should return success with a fully converted DeveloperProduct for a valid body", () => {
		expect.assertions(1);

		const body = {
			name: "Gem Pack",
			createdTimestamp: "2024-01-15T10:30:00.000Z",
			description: "A premium gem pack",
			iconImageAssetId: 67_890,
			isForSale: true,
			isImmutable: false,
			priceInformation: {
				defaultPriceInRobux: 100,
				enabledFeatures: ["RegionalPricing"],
			},
			productId: 12_345,
			storePageEnabled: true,
			universeId: 999,
			updatedTimestamp: "2024-03-20T14:45:00.000Z",
		} satisfies DeveloperProductConfigV2;

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "12345",
			name: "Gem Pack",
			createdAt: new Date("2024-01-15T10:30:00.000Z"),
			description: "A premium gem pack",
			iconImageAssetId: "67890",
			isForSale: true,
			isImmutable: false,
			price: {
				defaultPriceInRobux: 100,
				enabledFeatures: ["RegionalPricing"],
			},
			storePageEnabled: true,
			universeId: "999",
			updatedAt: new Date("2024-03-20T14:45:00.000Z"),
		});
	});

	it("should map a null priceInformation to an undefined price", () => {
		expect.assertions(1);

		const body = JSON.parse(
			`{
				"createdTimestamp": "2024-01-15T10:30:00.000Z",
				"description": "Free product",
				"iconImageAssetId": 99,
				"isForSale": false,
				"isImmutable": false,
				"name": "Free",
				"priceInformation": null,
				"productId": 42,
				"storePageEnabled": false,
				"universeId": 1,
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.price).toBeUndefined();
	});

	it("should map a null iconImageAssetId to undefined", () => {
		expect.assertions(1);

		const body = JSON.parse(
			`{
				"createdTimestamp": "2024-01-15T10:30:00.000Z",
				"description": "No icon",
				"iconImageAssetId": null,
				"isForSale": true,
				"isImmutable": false,
				"name": "No Icon",
				"priceInformation": null,
				"productId": 7,
				"storePageEnabled": false,
				"universeId": 1,
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.iconImageAssetId).toBeUndefined();
	});

	it("should return an ApiError when a required field is missing", () => {
		expect.assertions(3);

		const body = JSON.parse(
			`{
				"createdTimestamp": "2024-01-15T10:30:00.000Z",
				"description": "nameless",
				"iconImageAssetId": 67890,
				"isForSale": true,
				"isImmutable": false,
				"priceInformation": null,
				"productId": 12345,
				"storePageEnabled": true,
				"universeId": 999,
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 422 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed developer product response");
		expect(result.err.statusCode).toBe(422);
	});

	it.for([
		{ badValue: '"12345"', field: "productId" },
		{ badValue: "42", field: "name" },
		{ badValue: "false", field: "description" },
		{ badValue: '"yes"', field: "isForSale" },
		{ badValue: '"yes"', field: "isImmutable" },
		{ badValue: '"yes"', field: "storePageEnabled" },
		{ badValue: '"67890"', field: "iconImageAssetId" },
		{ badValue: '"999"', field: "universeId" },
		{ badValue: "12345", field: "createdTimestamp" },
		{ badValue: "12345", field: "updatedTimestamp" },
	])("should return an ApiError when $field has the wrong type", ({ badValue, field }) => {
		expect.assertions(2);

		const body = JSON.parse(
			`{
					"createdTimestamp": "2024-01-15T10:30:00.000Z",
					"description": "base",
					"iconImageAssetId": 1,
					"isForSale": true,
					"isImmutable": false,
					"name": "base",
					"priceInformation": null,
					"productId": 1,
					"storePageEnabled": false,
					"universeId": 1,
					"updatedTimestamp": "2024-03-20T14:45:00.000Z",
					"${field}": ${badValue}
				}`,
		);

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 502 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.statusCode).toBe(502);
	});

	it.for([
		{ field: "createdTimestamp" as const },
		{ field: "updatedTimestamp" as const },
	])(
		"should return an ApiError when $field is a string that does not parse to a Date",
		({ field }) => {
			expect.assertions(2);

			const body = validDeveloperProductBody({ [field]: "not-a-date" });

			const result = parseDeveloperProductResponse({ body, headers: {}, status: 502 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed developer product response");
		},
	);

	it("should return an ApiError when productId is the sentinel 0", () => {
		expect.assertions(1);

		const body = validDeveloperProductBody({ productId: 0 });

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when the body is not an object", () => {
		expect.assertions(1);

		const result = parseDeveloperProductResponse({
			body: "not an object",
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when the body is JSON null", () => {
		expect.assertions(1);

		const result = parseDeveloperProductResponse({
			body: JSON.parse("null"),
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should reject priceInformation that is an array with look-alike named properties", () => {
		expect.assertions(1);

		const priceInformation = Object.assign([], {
			defaultPriceInRobux: 100,
			enabledFeatures: ["Invalid"],
		});
		const body = {
			name: "Hostile",
			createdTimestamp: "2024-01-15T10:30:00.000Z",
			description: "hostile",
			iconImageAssetId: 1,
			isForSale: true,
			isImmutable: false,
			priceInformation,
			productId: 1,
			storePageEnabled: false,
			universeId: 1,
			updatedTimestamp: "2024-03-20T14:45:00.000Z",
		};

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 500 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should convert createdTimestamp into a createdAt Date at the same instant", () => {
		expect.assertions(1);

		const body = validDeveloperProductBody({ createdTimestamp: "2024-05-01T08:00:00.000Z" });

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.createdAt.toISOString()).toBe("2024-05-01T08:00:00.000Z");
	});

	it("should convert updatedTimestamp into an updatedAt Date at the same instant", () => {
		expect.assertions(1);

		const body = validDeveloperProductBody({ updatedTimestamp: "2024-07-14T18:30:00.000Z" });

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.updatedAt.toISOString()).toBe("2024-07-14T18:30:00.000Z");
	});

	it("should stringify the numeric productId into the public id", () => {
		expect.assertions(1);

		const body = validDeveloperProductBody({ productId: 987_654 });

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.id).toBe("987654");
	});

	it("should stringify the numeric universeId into the public universeId", () => {
		expect.assertions(1);

		const body = validDeveloperProductBody({ universeId: 7_777_777 });

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.universeId).toBe("7777777");
	});

	it("should stringify a present iconImageAssetId", () => {
		expect.assertions(1);

		const body = validDeveloperProductBody({ iconImageAssetId: 55_555 });

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.iconImageAssetId).toBe("55555");
	});

	it("should preserve isImmutable and storePageEnabled on the converted product", () => {
		expect.assertions(2);

		const body = validDeveloperProductBody({ isImmutable: true, storePageEnabled: false });

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.isImmutable).toBeTrue();
		expect(result.data.storePageEnabled).toBeFalse();
	});

	it("should preserve enabledFeatures on the converted price", () => {
		expect.assertions(1);

		const body = validDeveloperProductBody({
			priceInformation: {
				defaultPriceInRobux: 50,
				enabledFeatures: ["Invalid", "PriceOptimization", "UserFixedPrice"],
			},
		});

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);
		assert(result.data.price);

		expect(result.data.price.enabledFeatures).toStrictEqual([
			"Invalid",
			"PriceOptimization",
			"UserFixedPrice",
		]);
	});

	it("should map a nested null defaultPriceInRobux to undefined on price", () => {
		expect.assertions(1);

		const body = JSON.parse(
			`{
				"createdTimestamp": "2024-01-15T10:30:00.000Z",
				"description": "no default price",
				"iconImageAssetId": 7,
				"isForSale": true,
				"isImmutable": false,
				"name": "Flex",
				"priceInformation": { "defaultPriceInRobux": null, "enabledFeatures": [] },
				"productId": 7,
				"storePageEnabled": true,
				"universeId": 1,
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 200 });

		assert(result.success);
		assert(result.data.price);

		expect(result.data.price.defaultPriceInRobux).toBeUndefined();
	});

	it.for([
		{
			label: "priceInformation is not an object",
			priceBody: "42",
		},
		{
			label: "defaultPriceInRobux has the wrong type",
			priceBody: '{ "defaultPriceInRobux": "free", "enabledFeatures": [] }',
		},
		{
			label: "enabledFeatures is not an array",
			priceBody: '{ "defaultPriceInRobux": null, "enabledFeatures": {} }',
		},
		{
			label: "enabledFeatures contains an unknown value",
			priceBody: '{ "defaultPriceInRobux": null, "enabledFeatures": ["CustomThing"] }',
		},
	])("should return an ApiError when $label", ({ priceBody }) => {
		expect.assertions(1);

		const body = JSON.parse(
			`{
				"createdTimestamp": "2024-01-15T10:30:00.000Z",
				"description": "malformed price",
				"iconImageAssetId": 9,
				"isForSale": true,
				"isImmutable": false,
				"name": "Malformed",
				"priceInformation": ${priceBody},
				"productId": 9,
				"storePageEnabled": true,
				"universeId": 1,
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseDeveloperProductResponse({ body, headers: {}, status: 422 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});
});
