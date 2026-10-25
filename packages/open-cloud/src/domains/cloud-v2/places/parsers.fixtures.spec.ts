import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parsePlaceResponse } from "./parsers.ts";

// Captured 2026-10-25 from GET /cloud/v2/universes/{universeId}/places/{placeId}
// at apis.roblox.com, after discovering the root place through a universe GET.
// Universe/place ids and displayName are scrubbed; the empty description and
// templatePlace, timestamps, booleans and serverSize are unchanged.

describe(parsePlaceResponse, () => {
	it("should parse a captured GET 200 with an empty description and templatePlace", ({
		expect,
	}) => {
		expect.assertions(1);

		const body = loadFixture("places", "get-response.json");

		const result = parsePlaceResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "456",
			createdAt: new Date("2023-10-17T20:27:20.190Z"),
			description: "",
			displayName: "bedrock parser capture",
			root: true,
			serverSize: 50,
			universeId: "123",
			universeRuntimeCreation: false,
			updatedAt: new Date("2026-04-24T02:36:28.714Z"),
		});
	});
});
