import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseGamePassesListResponse } from "./parsers.ts";

// Captured 2026-10-25 from GET apis.roblox.com/game-passes/v1/universes/
// {universeId}/game-passes/creator?pageSize=1 using existing test-universe
// passes. Following the live nextPageToken returned a different existing pass.
// Game pass/icon ids, name and the opaque page token were replaced with stable
// fakes; field presence, types and all other values remain as received.

describe(parseGamePassesListResponse, () => {
	it("should parse a captured LIST 200 with an item and a next-page token", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("game-passes", "list-response.json");

		const result = parseGamePassesListResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			items: [
				{
					id: "12345678",
					name: "Captured test pass",
					createdAt: new Date("2026-10-23T19:59:14.231Z"),
					description: "",
					iconAssetId: "987654321",
					isForSale: false,
					isManagedPricingEnabled: false,
					price: { defaultPriceInRobux: 50, enabledFeatures: [] },
					updatedAt: new Date("2026-10-23T19:59:23.617Z"),
				},
			],
			nextPageToken: btoa("sanitized-next-page-token"),
		});
	});
});
