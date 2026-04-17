import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import { parseGamePassResponse } from "./parsers.ts";
import type { GamePassConfigV2 } from "./wire.ts";

function validBody(overrides: Partial<GamePassConfigV2> = {}): GamePassConfigV2 {
	return {
		name: "Pass",
		createdTimestamp: "2024-01-15T10:30:00.000Z",
		description: "Pass",
		gamePassId: 1,
		iconAssetId: 1,
		isForSale: true,
		priceInformation: { defaultPriceInRobux: 100, enabledFeatures: [] },
		updatedTimestamp: "2024-03-20T14:45:00.000Z",
		...overrides,
	};
}

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

		const result = parseGamePassResponse(body, 200);

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
		const body: unknown = JSON.parse(
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

		const result = parseGamePassResponse(body, 200);

		assert(result.success);

		expect(result.data.price).toBeUndefined();
	});

	it("should return an ApiError when a required field is missing", () => {
		expect.assertions(3);

		const body: unknown = JSON.parse(
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

		const result = parseGamePassResponse(body, 422);

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed game pass response");
		expect(result.err.statusCode).toBe(422);
	});

	it("should return an ApiError when a required field has the wrong type", () => {
		expect.assertions(2);

		const body: unknown = JSON.parse(
			`{
				"createdTimestamp": "2024-01-15T10:30:00.000Z",
				"description": "wrong-type gamePassId",
				"gamePassId": "12345",
				"iconAssetId": 67890,
				"isForSale": true,
				"name": "Bad Pass",
				"priceInformation": null,
				"updatedTimestamp": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseGamePassResponse(body, 502);

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.statusCode).toBe(502);
	});

	it("should convert createdTimestamp into a createdAt Date at the same instant", () => {
		expect.assertions(1);

		const body = validBody({ createdTimestamp: "2024-05-01T08:00:00.000Z" });

		const result = parseGamePassResponse(body, 200);

		assert(result.success);

		expect(result.data.createdAt.toISOString()).toBe("2024-05-01T08:00:00.000Z");
	});

	it("should convert updatedTimestamp into an updatedAt Date at the same instant", () => {
		expect.assertions(1);

		const body = validBody({ updatedTimestamp: "2024-07-14T18:30:00.000Z" });

		const result = parseGamePassResponse(body, 200);

		assert(result.success);

		expect(result.data.updatedAt.toISOString()).toBe("2024-07-14T18:30:00.000Z");
	});

	it("should stringify the numeric gamePassId into the public id", () => {
		expect.assertions(1);

		const body = validBody({ gamePassId: 987_654 });

		const result = parseGamePassResponse(body, 200);

		assert(result.success);

		expect(result.data.id).toBe("987654");
	});

	it("should treat iconAssetId 0 as an absent icon", () => {
		expect.assertions(1);

		const body = validBody({ iconAssetId: 0 });

		const result = parseGamePassResponse(body, 200);

		assert(result.success);

		expect(result.data.iconAssetId).toBeUndefined();
	});
});
