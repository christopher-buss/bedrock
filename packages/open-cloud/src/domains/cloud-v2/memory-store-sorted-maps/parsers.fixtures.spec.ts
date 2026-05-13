import { loadFixture } from "#tests/conformance/_helpers";
import { assert, describe, expect, it } from "vitest";

import { parseListResponse, parseSortedMapItemResponse } from "./parsers.ts";

// Captured against the live Open Cloud API at apis.roblox.com in
// 2026-05; universeId scrubbed to 123 and itemId/mapId replaced with
// neutral placeholders, otherwise the shape is verbatim. These
// fixtures exercise three real-server quirks the SDK absorbs:
//
//  - CREATE/LIST emit singular `memory-store` paths; GET emits plural
//    `memory-stores` (parser regex accepts both).
//  - LIST returns the array under `items`, not `memoryStoreSortedMapItems`
//    (apply-schema-patches renames the spec field).
//  - Item ids with URL-reserved characters round-trip URL-encoded
//    in `path`; the parser reads the decoded form from body.id.

describe("memory-store sorted-map parsers against captured live-API responses", () => {
	it("should parse a CREATE 200 with a URL-encoded item path", () => {
		expect.assertions(4);

		const body = loadFixture("memory-store-sorted-maps", "create-response.json");

		const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.id).toBe("name::id");
		expect(result.data.mapId).toBe("test-map");
		expect(result.data.universeId).toBe("123");
		expect(result.data.value).toStrictEqual({ hello: "world" });
	});

	it("should parse a GET 200 whose path uses the plural memory-stores prefix", () => {
		expect.assertions(4);

		const body = loadFixture("memory-store-sorted-maps", "get-response.json");

		const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.id).toBe("name::id");
		expect(result.data.mapId).toBe("test-map");
		expect(result.data.universeId).toBe("123");
		expect(result.data.value).toStrictEqual({ hello: "world" });
	});

	it("should parse a LIST 200 that uses the items field and a null nextPageToken", () => {
		expect.assertions(4);

		const body = loadFixture("memory-store-sorted-maps", "list-response.json");

		const result = parseListResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.items).toHaveLength(1);
		expect(result.data.items[0]?.id).toBe("name::id");
		expect(result.data.items[0]?.value).toStrictEqual({ hello: "world" });
		expect(result.data.nextPageToken).toBeUndefined();
	});
});
