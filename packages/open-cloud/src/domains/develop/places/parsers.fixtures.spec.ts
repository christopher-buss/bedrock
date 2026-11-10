import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parsePlacesListResponse } from "./parsers.ts";

// Captured 2026-11-09 unauthenticated from GET
// https://develop.roblox.com/v1/universes/{universeId}/places?limit=10, then
// the returned cursor followed to the last page. Ids, names, descriptions and
// cursors are replaced with stable fakes; see list-response.provenance.json.

describe(parsePlacesListResponse, () => {
	it("should parse a captured first page with a next cursor", ({ expect }) => {
		expect.assertions(3);

		const result = parsePlacesListResponse({
			body: loadFixture("places", "list-response-first-page.json"),
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data.items).toHaveLength(10);
		expect(result.data.items[1]).toStrictEqual({
			id: "457",
			name: "Bedrock Place 2",
			description: "",
			universeId: "123",
		});
		expect(result.data.nextPageToken).toBe("45600000000003_1_0123456789abcdef0123456789abcdef");
	});

	it("should parse a captured last page with a null cursor", ({ expect }) => {
		expect.assertions(2);

		const result = parsePlacesListResponse({
			body: loadFixture("places", "list-response-last-page.json"),
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data.items.map((place) => place.id)).toStrictEqual([
			"45600000000004",
			"45600000000005",
		]);
		expect(result.data.nextPageToken).toBeUndefined();
	});
});
