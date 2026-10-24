import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseBadgeResponse } from "./parsers.ts";

// Captured against the live Open Cloud API at apis.roblox.com in
// 2026-10; badge, icon and awarder ids scrubbed to placeholders,
// otherwise the shape is verbatim. The awarder carries no `name` and
// sends its kind as the string `"Place"`, not the integer the schema
// declares.

describe(parseBadgeResponse, () => {
	it("should parse a captured CREATE 200 whose awarder has a string type and no name", ({
		expect,
	}) => {
		expect.assertions(1);

		const body = loadFixture("badges", "create-response.json");

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "123",
			name: "bedrock parser capture",
			awarder: { id: "789", name: undefined, type: "Place" },
			createdAt: new Date("2026-10-24T00:25:48.795Z"),
			description: "Captured to verify the ocale badge parser",
			displayDescription: "Captured to verify the ocale badge parser",
			displayIconImageId: "456",
			displayName: "bedrock parser capture",
			enabled: false,
			iconImageId: "456",
			statistics: { awardedCount: 0, pastDayAwardedCount: 0, winRatePercentage: 0 },
			updatedAt: new Date("2026-10-24T00:25:48.795Z"),
		});
	});
});
