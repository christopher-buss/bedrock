import { validGamePassBody, validListGamePassesBody } from "#tests/helpers/game-passes";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseGamePassesListResponse, parseGamePassResponse } from "./parsers.ts";
import type { GamePassConfigV2 } from "./wire.ts";

describe(parseGamePassResponse, () => {
	it("should return success with a fully converted GamePass for a valid body", () => {
		expect.assertions(1);

		const body = {
			name: "Epic Pass",
			createdTimestamp: "2024-01-15T10:30:00.000Z",
			description: "Unlocks epic stuff",
			gamePassId: 12345,
			iconAssetId: 67890,
			isForSale: true,
			priceInformation: {
				defaultPriceInRobux: 100,
				enabledFeatures: ["RegionalPricing"],
			},
			updatedTimestamp: "2024-03-20T14:45:00.000Z",
		} satisfies GamePassConfigV2;

		const result = parseGamePassResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "12345",
			name: "Epic Pass",
			createdAt: new Date("2024-01-15T10:30:00.000Z"),
			description: "Unlocks epic stuff",
			iconAssetId: "67890",
			isForSale: true,
			price: {
				defaultPriceInRobux: 100,
				enabledFeatures: ["RegionalPricing"],
			},
			updatedAt: new Date("2024-03-20T14:45:00.000Z"),
		});
	});

	it("should map a null priceInformation to an undefined price", () => {
		expect.assertions(1);

		// The API sends a literal JSON `null` when no price is configured;
		// `JSON.parse` preserves it as runtime null so we exercise the
		// normalization the parser performs at the wire boundary.
		const body = JSON.parse(
			`{
				"createdTimestamp": "2024-01-15T10:30:00.000Z",
				"description": "Free pass",
				"gamePassId": 42,
				"iconAssetId": 99,
				"isForSale": false,
				"name": "Free Pass",
				"priceInformation": null,
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseGamePassResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.price).toBeUndefined();
	});

	it("should return an ApiError when a required field is missing", () => {
		expect.assertions(3);

		const body = JSON.parse(
			`{
				"createdTimestamp": "2024-01-15T10:30:00.000Z",
				"description": "nameless",
				"gamePassId": 12345,
				"iconAssetId": 67890,
				"isForSale": true,
				"priceInformation": null,
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseGamePassResponse({ body, headers: {}, status: 422 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed game pass response");
		expect(result.err.statusCode).toBe(422);
	});

	it.for([
		{ badValue: '"12345"', field: "gamePassId" },
		{ badValue: "42", field: "name" },
		{ badValue: "false", field: "description" },
		{ badValue: '"yes"', field: "isForSale" },
		{ badValue: '"67890"', field: "iconAssetId" },
		{ badValue: "12345", field: "createdTimestamp" },
		{ badValue: "12345", field: "updatedTimestamp" },
	])("should return an ApiError when $field has the wrong type", ({ badValue, field }) => {
		expect.assertions(2);

		// Duplicate keys are allowed in JSON; `JSON.parse` keeps the last
		// occurrence so interpolating `badValue` at the end overrides the
		// valid baseline.
		const body = JSON.parse(
			`{
					"createdTimestamp": "2024-01-15T10:30:00.000Z",
					"description": "base",
					"gamePassId": 1,
					"iconAssetId": 1,
					"isForSale": true,
					"name": "base",
					"priceInformation": null,
					"updatedTimestamp": "2024-03-20T14:45:00.000Z",
					"${field}": ${badValue}
				}`,
		);

		const result = parseGamePassResponse({ body, headers: {}, status: 502 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.statusCode).toBe(502);
	});

	it("should return an ApiError when the body is not an object", () => {
		expect.assertions(1);

		const result = parseGamePassResponse({ body: "not an object", headers: {}, status: 500 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when the body is JSON null", () => {
		expect.assertions(1);

		// Without the top-level isRecord guard, `null["field"]` would throw;
		// this test locks in the nullish rejection path.
		const result = parseGamePassResponse({
			body: JSON.parse("null"),
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it.for([
		{ field: "createdTimestamp" as const },
		{ field: "updatedTimestamp" as const },
	])(
		"should return an ApiError when $field is a string that does not parse to a Date",
		({ field }) => {
			expect.assertions(2);

			const body = validGamePassBody({ [field]: "not-a-date" });

			const result = parseGamePassResponse({ body, headers: {}, status: 502 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed game pass response");
		},
	);

	it("should reject priceInformation that is an array with look-alike named properties", () => {
		expect.assertions(1);

		// Adversarial input: JavaScript arrays can carry named properties
		// alongside their numeric indices. The inner isRecord guard is what
		// distinguishes a legitimate record from such an array; this test
		// locks in that the guard still fires even when every field-level
		// check would otherwise accept the value.
		const priceInformation = Object.assign([], {
			defaultPriceInRobux: 100,
			enabledFeatures: ["Invalid"],
		});
		const body = {
			name: "Hostile",
			createdTimestamp: "2024-01-15T10:30:00.000Z",
			description: "hostile",
			gamePassId: 1,
			iconAssetId: 1,
			isForSale: true,
			priceInformation,
			updatedTimestamp: "2024-03-20T14:45:00.000Z",
		};

		const result = parseGamePassResponse({ body, headers: {}, status: 500 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should convert createdTimestamp into a createdAt Date at the same instant", () => {
		expect.assertions(1);

		const body = validGamePassBody({ createdTimestamp: "2024-05-01T08:00:00.000Z" });

		const result = parseGamePassResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.createdAt.toISOString()).toBe("2024-05-01T08:00:00.000Z");
	});

	it("should convert updatedTimestamp into an updatedAt Date at the same instant", () => {
		expect.assertions(1);

		const body = validGamePassBody({ updatedTimestamp: "2024-07-14T18:30:00.000Z" });

		const result = parseGamePassResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.updatedAt.toISOString()).toBe("2024-07-14T18:30:00.000Z");
	});

	it("should stringify the numeric gamePassId into the public id", () => {
		expect.assertions(1);

		const body = validGamePassBody({ gamePassId: 987_654 });

		const result = parseGamePassResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.id).toBe("987654");
	});

	it("should treat iconAssetId 0 as an absent icon", () => {
		expect.assertions(1);

		const body = validGamePassBody({ iconAssetId: 0 });

		const result = parseGamePassResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.iconAssetId).toBeUndefined();
	});

	it("should stringify a nonzero iconAssetId", () => {
		expect.assertions(1);

		const body = validGamePassBody({ iconAssetId: 55_555 });

		const result = parseGamePassResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.iconAssetId).toBe("55555");
	});

	it("should preserve enabledFeatures on the converted price", () => {
		expect.assertions(1);

		const body = validGamePassBody({
			priceInformation: {
				defaultPriceInRobux: 50,
				enabledFeatures: ["Invalid", "PriceOptimization", "UserFixedPrice"],
			},
		});

		const result = parseGamePassResponse({ body, headers: {}, status: 200 });

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

		// Nested JSON null inside priceInformation — the parser normalizes
		// it to undefined on the public GamePassPrice.
		const body = JSON.parse(
			`{
				"createdTimestamp": "2024-01-15T10:30:00.000Z",
				"description": "no default price",
				"gamePassId": 7,
				"iconAssetId": 7,
				"isForSale": true,
				"name": "Flex",
				"priceInformation": { "defaultPriceInRobux": null, "enabledFeatures": [] },
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseGamePassResponse({ body, headers: {}, status: 200 });

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
				"gamePassId": 9,
				"iconAssetId": 9,
				"isForSale": true,
				"name": "Malformed",
				"priceInformation": ${priceBody},
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseGamePassResponse({ body, headers: {}, status: 422 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});
});

describe(parseGamePassesListResponse, () => {
	it("should return a Page wrapping the converted gamePasses items", () => {
		expect.assertions(2);

		const body = validListGamePassesBody({
			gamePasses: [
				validGamePassBody({ name: "First", gamePassId: 1 }),
				validGamePassBody({ name: "Second", gamePassId: 2 }),
			],
			nextPageToken: "cursor",
		});

		const result = parseGamePassesListResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.items.map((item) => item.id)).toStrictEqual(["1", "2"]);
		expect(result.data.nextPageToken).toBe("cursor");
	});

	it("should return undefined nextPageToken when the wire field is omitted", () => {
		expect.assertions(1);

		const body = JSON.parse(
			`{
				"gamePasses": []
			}`,
		);

		const result = parseGamePassesListResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.nextPageToken).toBeUndefined();
	});

	it("should normalize a JSON null nextPageToken to undefined", () => {
		expect.assertions(1);

		const body = JSON.parse(
			`{
				"gamePasses": [],
				"nextPageToken": null
			}`,
		);

		const result = parseGamePassesListResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.nextPageToken).toBeUndefined();
	});

	it("should return an empty page when the wire returns no items", () => {
		expect.assertions(2);

		const body = validListGamePassesBody({ gamePasses: [] });

		const result = parseGamePassesListResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.items).toStrictEqual([]);
		expect(result.data.nextPageToken).toBeUndefined();
	});

	it("should return an ApiError when the body is not an object", () => {
		expect.assertions(2);

		const result = parseGamePassesListResponse({
			body: "not an object",
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed game passes list response");
	});

	it("should return an ApiError when gamePasses is missing", () => {
		expect.assertions(1);

		const result = parseGamePassesListResponse({
			body: { nextPageToken: "cursor" },
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when gamePasses is not an array", () => {
		expect.assertions(1);

		const result = parseGamePassesListResponse({
			body: { gamePasses: "nope", nextPageToken: undefined },
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when an item in gamePasses is malformed", () => {
		expect.assertions(1);

		const body = {
			gamePasses: [validGamePassBody(), { not: "a-game-pass" }],
			nextPageToken: undefined,
		};

		const result = parseGamePassesListResponse({ body, headers: {}, status: 500 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when nextPageToken is not a string", () => {
		expect.assertions(1);

		const body = { gamePasses: [], nextPageToken: 42 };

		const result = parseGamePassesListResponse({ body, headers: {}, status: 500 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});
});
