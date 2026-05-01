import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parsePlaceResponse } from "./parsers.ts";
import type { PlaceWire } from "./wire.ts";

function validPlaceBody(overrides: Partial<PlaceWire> = {}): PlaceWire {
	return {
		createTime: "2024-01-15T10:30:00.000Z",
		description: "A sample place.",
		displayName: "Test Place",
		path: "universes/123/places/456",
		root: true,
		serverSize: 30,
		universeRuntimeCreation: false,
		updateTime: "2024-11-02T17:08:21.500Z",
		...overrides,
	};
}

function okPlaceResponse(body: PlaceWire): Parameters<typeof parsePlaceResponse>[0] {
	return { body, headers: {}, status: 200 };
}

describe(parsePlaceResponse, () => {
	it("should parse a full valid body into the public Place shape", () => {
		expect.assertions(1);

		const result = parsePlaceResponse(okPlaceResponse(validPlaceBody()));

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "456",
			createdAt: new Date("2024-01-15T10:30:00.000Z"),
			description: "A sample place.",
			displayName: "Test Place",
			root: true,
			serverSize: 30,
			universeId: "123",
			universeRuntimeCreation: false,
			updatedAt: new Date("2024-11-02T17:08:21.500Z"),
		});
	});

	describe("optional normalization", () => {
		it("should default missing root to false", () => {
			expect.assertions(1);

			const result = parsePlaceResponse(okPlaceResponse(validPlaceBody({ root: undefined })));

			assert(result.success);

			expect(result.data.root).toBeFalse();
		});

		it("should default missing universeRuntimeCreation to false", () => {
			expect.assertions(1);

			const result = parsePlaceResponse(
				okPlaceResponse(validPlaceBody({ universeRuntimeCreation: undefined })),
			);

			assert(result.success);

			expect(result.data.universeRuntimeCreation).toBeFalse();
		});

		it("should surface serverSize as undefined when omitted", () => {
			expect.assertions(1);

			const result = parsePlaceResponse(
				okPlaceResponse(validPlaceBody({ serverSize: undefined })),
			);

			assert(result.success);

			expect(result.data.serverSize).toBeUndefined();
		});

		it("should normalize a JSON null serverSize to undefined", () => {
			expect.assertions(1);

			// JSON.parse("null") dodges the `unicorn/no-null` source rule
			// while still producing the literal null value at runtime. The
			// body is widened so the null slips past the `T | undefined`
			// wire annotation while still hitting the parser.
			const body: Record<string, unknown> = {
				...validPlaceBody(),
				serverSize: JSON.parse("null"),
			};

			const result = parsePlaceResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.serverSize).toBeUndefined();
		});

		it("should normalize a JSON null root to false", () => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...validPlaceBody(),
				root: JSON.parse("null"),
			};

			const result = parsePlaceResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.root).toBeFalse();
		});

		it("should normalize a JSON null universeRuntimeCreation to false", () => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...validPlaceBody(),
				universeRuntimeCreation: JSON.parse("null"),
			};

			const result = parsePlaceResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.universeRuntimeCreation).toBeFalse();
		});
	});

	describe("id extraction", () => {
		it("should extract the numeric universeId and place id from the resource path", () => {
			expect.assertions(2);

			const result = parsePlaceResponse(
				okPlaceResponse(validPlaceBody({ path: "universes/99999/places/88888" })),
			);

			assert(result.success);

			expect(result.data.universeId).toBe("99999");
			expect(result.data.id).toBe("88888");
		});

		it("should reject a body whose path does not match universes/{uid}/places/{pid}", () => {
			expect.assertions(2);

			const result = parsePlaceResponse(
				okPlaceResponse(validPlaceBody({ path: "universes/123" })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed place response");
		});

		it("should reject a path with trailing junk after the place id", () => {
			expect.assertions(1);

			const result = parsePlaceResponse(
				okPlaceResponse(validPlaceBody({ path: "universes/123/places/456/extra" })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a path with leading junk before the universes segment", () => {
			expect.assertions(1);

			const result = parsePlaceResponse(
				okPlaceResponse(validPlaceBody({ path: "prefix/universes/123/places/456" })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});
	});

	describe("malformed bodies", () => {
		it("should reject a non-record body", () => {
			expect.assertions(2);

			const result = parsePlaceResponse({
				body: "not an object",
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it.for(["createTime", "description", "displayName", "path", "updateTime"] as const)(
			"should reject a body missing the required %s field",
			(field) => {
				expect.assertions(1);

				const { [field]: _removed, ...rest } = validPlaceBody();
				const result = parsePlaceResponse({ body: rest, headers: {}, status: 200 });

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
			},
		);

		it.for(["createTime", "description", "displayName", "updateTime"] as const)(
			"should reject a body whose required %s field is not a string",
			(field) => {
				expect.assertions(1);

				const body = { ...validPlaceBody(), [field]: 123 };
				const result = parsePlaceResponse({ body, headers: {}, status: 200 });

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
			},
		);

		it("should reject a body whose path is a non-string with a matching toString", () => {
			// A toString() that matches the universes/{uid}/places/{pid}
			// pattern would let regex.exec succeed on the coerced string,
			// so this guards that the parser rejects by type before any
			// regex coercion.
			expect.assertions(1);

			const body = {
				...validPlaceBody(),
				path: { toString: (): string => "universes/1/places/2" },
			};
			const result = parsePlaceResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject an array body even when it carries a valid place shape", () => {
			expect.assertions(1);

			const arrayWithShape = Object.assign([0], validPlaceBody());
			const result = parsePlaceResponse({ body: arrayWithShape, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose serverSize is not a number", () => {
			expect.assertions(1);

			const body = { ...validPlaceBody(), serverSize: "thirty" };
			const result = parsePlaceResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose root is not a boolean", () => {
			expect.assertions(1);

			const body = { ...validPlaceBody(), root: "yes" };
			const result = parsePlaceResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose universeRuntimeCreation is not a boolean", () => {
			expect.assertions(1);

			const body = { ...validPlaceBody(), universeRuntimeCreation: 1 };
			const result = parsePlaceResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should propagate the response status code on the returned ApiError", () => {
			expect.assertions(1);

			const result = parsePlaceResponse({ body: "nope", headers: {}, status: 502 });

			assert(!result.success);

			expect(result.err.statusCode).toBe(502);
		});
	});
});
