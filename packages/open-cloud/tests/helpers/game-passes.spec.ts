import { validGamePassBody } from "#tests/helpers/game-passes";
import { describe, expect, it } from "vitest";

describe(validGamePassBody, () => {
	it("should produce a minimally-valid default body matching the GamePassConfigV2 schema", () => {
		expect.assertions(1);

		expect(validGamePassBody()).toStrictEqual({
			name: "Epic Pass",
			createdTimestamp: "2024-01-15T10:30:00.000Z",
			description: "Unlocks epic stuff",
			gamePassId: 12_345,
			iconAssetId: 67_890,
			isForSale: true,
			priceInformation: { defaultPriceInRobux: 100, enabledFeatures: [] },
			updatedTimestamp: "2024-03-20T14:45:00.000Z",
		});
	});

	it("should apply shallow overrides on top of the defaults", () => {
		expect.assertions(2);

		const body = validGamePassBody({ name: "Other", gamePassId: 42 });

		expect(body.gamePassId).toBe(42);
		expect(body.name).toBe("Other");
	});
});
