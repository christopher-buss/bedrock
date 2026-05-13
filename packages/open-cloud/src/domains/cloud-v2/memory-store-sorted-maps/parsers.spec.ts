import {
	validListSortedMapItemsBody,
	validSortedMapItemBody,
} from "#tests/helpers/memory-store-sorted-maps";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseListResponse, parseSortedMapItemResponse } from "./parsers.ts";
import type { MemoryStoreSortedMapItemWire } from "./wire.ts";

function okSortedMapItemResponse(
	body: MemoryStoreSortedMapItemWire,
): Parameters<typeof parseSortedMapItemResponse>[0] {
	return { body, headers: {}, status: 200 };
}

describe(parseListResponse, () => {
	it("should parse a valid list response into items and a nextPageToken", () => {
		expect.assertions(2);

		const result = parseListResponse({
			body: validListSortedMapItemsBody({ nextPageToken: "tok-42" }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.items).toHaveLength(1);
		expect(result.data.nextPageToken).toBe("tok-42");
	});

	it("should surface a missing nextPageToken as undefined", () => {
		expect.assertions(1);

		const result = parseListResponse({
			body: validListSortedMapItemsBody(),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.nextPageToken).toBeUndefined();
	});

	it("should normalize a JSON null nextPageToken to undefined", () => {
		expect.assertions(1);

		const body: Record<string, unknown> = {
			...validListSortedMapItemsBody(),
			nextPageToken: JSON.parse("null"),
		};

		const result = parseListResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.nextPageToken).toBeUndefined();
	});

	it("should map every entry through the same parser as the single-item endpoints", () => {
		expect.assertions(3);

		const result = parseListResponse({
			body: validListSortedMapItemsBody({
				items: [
					validSortedMapItemBody({
						id: "first",
						path: "cloud/v2/universes/1/memory-store/sorted-maps/m/items/first",
					}),
					validSortedMapItemBody({
						id: "second",
						numericSortKey: 7,
						path: "cloud/v2/universes/1/memory-store/sorted-maps/m/items/second",
						stringSortKey: undefined,
					}),
				],
			}),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.items).toHaveLength(2);
		expect(result.data.items[0]?.id).toBe("first");
		expect(result.data.items[1]?.sortKey).toStrictEqual({ kind: "numeric", value: 7 });
	});

	it("should accept an empty items array", () => {
		expect.assertions(1);

		const result = parseListResponse({
			body: validListSortedMapItemsBody({ items: [] }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.items).toStrictEqual([]);
	});

	it("should accept a response with items omitted", () => {
		expect.assertions(2);

		const result = parseListResponse({
			body: { nextPageToken: "tok-1" },
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.items).toStrictEqual([]);
		expect(result.data.nextPageToken).toBe("tok-1");
	});

	it("should accept a response with items explicitly null", () => {
		expect.assertions(2);

		const body: Record<string, unknown> = {
			items: JSON.parse("null"),
		};

		const result = parseListResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.items).toStrictEqual([]);
		expect(result.data.nextPageToken).toBeUndefined();
	});

	it("should reject a non-record body", () => {
		expect.assertions(2);

		const result = parseListResponse({
			body: "nope",
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed memory-store sorted-map list response");
	});

	it("should reject a body whose items is not an array", () => {
		expect.assertions(1);

		const result = parseListResponse({
			body: { ...validListSortedMapItemsBody(), items: "nope" },
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should reject a body whose nextPageToken is a non-string non-undefined value", () => {
		expect.assertions(1);

		const result = parseListResponse({
			body: { ...validListSortedMapItemsBody(), nextPageToken: 42 },
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should reject a body whose items contains a malformed entry", () => {
		expect.assertions(1);

		const malformedItem: Record<string, unknown> = {
			...validSortedMapItemBody(),
			path: 12_345,
		};
		const result = parseListResponse({
			body: {
				...validListSortedMapItemsBody(),
				items: [malformedItem],
			},
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should propagate the response status code on the returned ApiError", () => {
		expect.assertions(1);

		const result = parseListResponse({
			body: "nope",
			headers: {},
			status: 503,
		});

		assert(!result.success);

		expect(result.err.statusCode).toBe(503);
	});
});

describe(parseSortedMapItemResponse, () => {
	it("should parse a full valid body into the public SortedMapItem shape", () => {
		expect.assertions(1);

		const result = parseSortedMapItemResponse(
			okSortedMapItemResponse(validSortedMapItemBody()),
		);

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "abc123",
			etag: 'W/"v1"',
			expiresAt: new Date("2026-06-21T15:08:58.4806559Z"),
			mapId: "test-map",
			sortKey: { kind: "string", value: "score-100" },
			universeId: "123",
			value: "hello",
		});
	});

	describe("sort-key normalization", () => {
		it("should surface a numeric sort key as a numeric SortKey", () => {
			expect.assertions(1);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(
					validSortedMapItemBody({
						numericSortKey: 7.5,
						stringSortKey: undefined,
					}),
				),
			);

			assert(result.success);

			expect(result.data.sortKey).toStrictEqual({ kind: "numeric", value: 7.5 });
		});

		it("should surface no sort key as undefined when both wire fields are absent", () => {
			expect.assertions(1);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(
					validSortedMapItemBody({
						numericSortKey: undefined,
						stringSortKey: undefined,
					}),
				),
			);

			assert(result.success);

			expect(result.data.sortKey).toBeUndefined();
		});

		it("should normalize a JSON null stringSortKey to undefined", () => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...validSortedMapItemBody({ stringSortKey: undefined }),
				stringSortKey: JSON.parse("null"),
			};

			const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.sortKey).toBeUndefined();
		});

		it("should normalize a JSON null numericSortKey to undefined", () => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...validSortedMapItemBody({ stringSortKey: undefined }),
				numericSortKey: JSON.parse("null"),
			};

			const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.sortKey).toBeUndefined();
		});

		it("should reject a response carrying both stringSortKey and numericSortKey", () => {
			expect.assertions(2);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(
					validSortedMapItemBody({
						numericSortKey: 1,
						stringSortKey: "a",
					}),
				),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed memory-store sorted-map item response");
		});
	});

	describe("value preservation", () => {
		it("should preserve nested null values inside an object payload", () => {
			expect.assertions(1);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(
					validSortedMapItemBody({ value: { a: "x", b: JSON.parse("null") } }),
				),
			);

			assert(result.success);

			expect(result.data.value).toStrictEqual({ a: "x", b: JSON.parse("null") });
		});

		it("should preserve a falsy primitive payload (zero) verbatim", () => {
			expect.assertions(1);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(validSortedMapItemBody({ value: 0 })),
			);

			assert(result.success);

			expect(result.data.value).toBe(0);
		});

		it("should accept a JSON null value at the top level", () => {
			expect.assertions(1);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(validSortedMapItemBody({ value: JSON.parse("null") })),
			);

			assert(result.success);

			expect(result.data.value).toBeNull();
		});
	});

	describe("id extraction", () => {
		it("should extract universeId and mapId from the resource path and id from the body", () => {
			expect.assertions(3);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(
					validSortedMapItemBody({
						id: "400ffff0001",
						path: "cloud/v2/universes/99999/memory-store/sorted-maps/some-map/items/400ffff0001",
					}),
				),
			);

			assert(result.success);

			expect(result.data.universeId).toBe("99999");
			expect(result.data.mapId).toBe("some-map");
			expect(result.data.id).toBe("400ffff0001");
		});

		it("should surface the body's id field decoded even when the path contains URL-encoded characters", () => {
			expect.assertions(1);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(
					validSortedMapItemBody({
						id: "name::id",
						path: "cloud/v2/universes/99999/memory-store/sorted-maps/m/items/name%3A%3Aid",
					}),
				),
			);

			assert(result.success);

			expect(result.data.id).toBe("name::id");
		});

		it("should accept a path that uses the plural memory-stores prefix the GET endpoint emits", () => {
			expect.assertions(3);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(
					validSortedMapItemBody({
						id: "400ffff0001",
						path: "cloud/v2/universes/99999/memory-stores/sorted-maps/some-map/items/400ffff0001",
					}),
				),
			);

			assert(result.success);

			expect(result.data.universeId).toBe("99999");
			expect(result.data.mapId).toBe("some-map");
			expect(result.data.id).toBe("400ffff0001");
		});

		it("should reject a path that does not match the sorted-map item pattern", () => {
			expect.assertions(2);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(
					validSortedMapItemBody({ path: "universes/123/places/456" }),
				),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed memory-store sorted-map item response");
		});
	});

	describe("malformed bodies", () => {
		it("should reject a non-record body", () => {
			expect.assertions(2);

			const result = parseSortedMapItemResponse({
				body: "not an object",
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it.for(["etag", "expireTime", "id", "path", "value"] as const)(
			"should reject a body missing the required %s field",
			(field) => {
				expect.assertions(1);

				const { [field]: _removed, ...rest } = validSortedMapItemBody();
				const result = parseSortedMapItemResponse({
					body: rest,
					headers: {},
					status: 200,
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
			},
		);

		it("should reject a body whose path is a non-string with a matching toString", () => {
			expect.assertions(1);

			const body = {
				...validSortedMapItemBody(),
				path: {
					toString: (): string =>
						"cloud/v2/universes/1/memory-store/sorted-maps/m/items/i",
				},
			};
			const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose etag is not a string", () => {
			expect.assertions(1);

			const body = { ...validSortedMapItemBody(), etag: 123 };
			const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose expireTime is not a string", () => {
			expect.assertions(1);

			const body = { ...validSortedMapItemBody(), expireTime: 0 };
			const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose expireTime is a string that does not parse to a Date", () => {
			expect.assertions(1);

			const body = { ...validSortedMapItemBody(), expireTime: "not-a-date" };
			const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose stringSortKey is not a string", () => {
			expect.assertions(1);

			const body = { ...validSortedMapItemBody(), stringSortKey: 0 };
			const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose numericSortKey is not a number", () => {
			expect.assertions(1);

			const body = {
				...validSortedMapItemBody({ stringSortKey: undefined }),
				numericSortKey: "high",
			};
			const result = parseSortedMapItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject an array body even when it carries a valid sorted-map item shape", () => {
			expect.assertions(1);

			const arrayWithShape = Object.assign([0], validSortedMapItemBody());
			const result = parseSortedMapItemResponse({
				body: arrayWithShape,
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should propagate the response status code on the returned ApiError", () => {
			expect.assertions(1);

			const result = parseSortedMapItemResponse({ body: "nope", headers: {}, status: 502 });

			assert(!result.success);

			expect(result.err.statusCode).toBe(502);
		});
	});
});
