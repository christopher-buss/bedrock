import { validSortedMapItemBody } from "#tests/helpers/memory-store-sorted-maps";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseSortedMapItemResponse } from "./parsers.ts";
import type { MemoryStoreSortedMapItemWire } from "./wire.ts";

function okSortedMapItemResponse(
	body: MemoryStoreSortedMapItemWire,
): Parameters<typeof parseSortedMapItemResponse>[0] {
	return { body, headers: {}, status: 200 };
}

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
		it("should extract universeId, mapId, and id from the resource path", () => {
			expect.assertions(3);

			const result = parseSortedMapItemResponse(
				okSortedMapItemResponse(
					validSortedMapItemBody({
						path: "cloud/v2/universes/99999/memory-store/sorted-maps/some-map/items/400ffff0001",
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
