import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parsePlacesListResponse } from "./parsers.ts";

// Captured 2026-11-09 unauthenticated from GET
// https://develop.roblox.com/v1/universes/47545/places?limit=10, then the
// returned cursor followed to the last page. Public data, kept verbatim.

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
			id: "191029074",
			name: "Pizza Place: Party Island",
			description: "",
			universeId: "47545",
		});
		expect(result.data.nextPageToken).toBe(
			"110514925318787_1_2770f76f7061192b85bbbdbadaeac6f4",
		);
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
			"115329785369435",
			"138687392359748",
		]);
		expect(result.data.nextPageToken).toBeUndefined();
	});
});
