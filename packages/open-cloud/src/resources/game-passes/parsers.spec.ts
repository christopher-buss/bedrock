import { assert, describe, expect, it } from "vitest";

import { parseGamePassResponse } from "./parsers.ts";
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
});
