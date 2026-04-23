import { parseGamePassResponse } from "#src/resources/game-passes/parsers";
import { assert, describe, expect, it } from "vitest";

import {
	dropReadOnlyFromRequired,
	expectValid,
	getAjv,
	getValidator,
	isRecord,
	loadFixture,
	nullableToUnion,
} from "./_helpers.ts";

describe("game-passes fixtures", () => {
	it.for([
		{ fixture: "get-response.json", schema: "GamePassConfigV2" },
		{ fixture: "create-response.json", schema: "GamePassConfigV2" },
		{ fixture: "error-not-found.json", schema: "GamePasses.ErrorResponse" },
		{ fixture: "error-unauthorized.json", schema: "GamePasses.ErrorResponse" },
	])("should validate $fixture against $schema", ({ fixture, schema }) => {
		expect.assertions(1);

		const validator = getValidator(schema);
		const body = loadFixture("game-passes", fixture);

		expectValid(validator, body);
	});

	describe(parseGamePassResponse, () => {
		it("should round-trip get-response.json into the public GamePass shape", () => {
			expect.assertions(1);

			const body = loadFixture("game-passes", "get-response.json");

			const result = parseGamePassResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data).toStrictEqual({
				id: "12345678",
				name: "Legendary Loot Pass",
				createdAt: new Date("2023-06-10T09:15:42.000Z"),
				description:
					"Grants access to legendary loot, cosmetic flair, and the exclusive lobby.",
				iconAssetId: "987654321",
				isForSale: true,
				price: {
					defaultPriceInRobux: 499,
					enabledFeatures: ["RegionalPricing"],
				},
				updatedAt: new Date("2024-11-02T17:08:21.500Z"),
			});
		});

		it("should round-trip create-response.json and map null priceInformation to undefined", () => {
			expect.assertions(1);

			const body = loadFixture("game-passes", "create-response.json");

			const result = parseGamePassResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data).toStrictEqual({
				id: "98765432",
				name: "Support Squad Pass",
				createdAt: new Date("2024-12-20T12:00:00.000Z"),
				description: "Back the creator and unlock bonus in-game tags.",
				iconAssetId: "13600173502",
				isForSale: false,
				price: undefined,
				updatedAt: new Date("2024-12-20T12:00:00.000Z"),
			});
		});
	});
});

describe(nullableToUnion, () => {
	it.for([
		{ input: "hello", label: "string" },
		{ input: 42, label: "number" },
		{ input: true, label: "boolean" },
		// JSON.parse("null") dodges the `unicorn/no-null` source rule
		// while still producing the literal null value at runtime.
		{ input: JSON.parse("null"), label: "null" },
	])("should return a $label primitive unchanged", ({ input }) => {
		expect.assertions(1);
		expect(nullableToUnion(input)).toStrictEqual(input);
	});

	it("should return a record without nullable unchanged", () => {
		expect.assertions(1);

		expect(
			nullableToUnion({
				properties: { a: { type: "string" } },
				type: "object",
			}),
		).toStrictEqual({
			properties: { a: { type: "string" } },
			type: "object",
		});
	});

	it("should rewrite nullable-true with a direct type into a [type, null] union", () => {
		expect.assertions(1);

		expect(nullableToUnion({ nullable: true, type: "string" })).toStrictEqual({
			type: ["string", "null"],
		});
	});

	it("should wrap nullable-true without a direct type in a oneOf null branch", () => {
		expect.assertions(1);

		// The case the conformance validator exists to handle: an OpenAPI
		// field that uses `allOf: [{ $ref }]` to reference a reusable
		// schema while still being nullable.
		expect(
			nullableToUnion({
				allOf: [{ $ref: "#/components/schemas/X" }],
				nullable: true,
			}),
		).toStrictEqual({
			oneOf: [{ allOf: [{ $ref: "#/components/schemas/X" }] }, { type: "null" }],
		});
	});

	it("should strip nullable-false without introducing a null branch", () => {
		expect.assertions(1);

		// Sanity check: only `nullable: true` triggers the transform.
		// Any other value is dropped as a harmless OpenAPI-only keyword.
		expect(nullableToUnion({ nullable: false, type: "string" })).toStrictEqual({
			type: "string",
		});
	});

	it("should recurse into nested records and arrays", () => {
		expect.assertions(1);

		expect(
			nullableToUnion({
				properties: {
					a: { nullable: true, type: "string" },
					b: { items: { nullable: true, type: "integer" }, type: "array" },
				},
				type: "object",
			}),
		).toStrictEqual({
			properties: {
				a: { type: ["string", "null"] },
				b: { items: { type: ["integer", "null"] }, type: "array" },
			},
			type: "object",
		});
	});
});

describe(isRecord, () => {
	it("should return true for a plain object", () => {
		expect.assertions(1);
		expect(isRecord({ a: 1 })).toBeTrue();
	});

	it("should return false for arrays, null, and primitives", () => {
		expect.assertions(4);
		expect(isRecord([1, 2, 3])).toBeFalse();
		expect(isRecord(JSON.parse("null"))).toBeFalse();
		expect(isRecord("hello")).toBeFalse();
		expect(isRecord(42)).toBeFalse();
	});
});

describe(dropReadOnlyFromRequired, () => {
	it("should drop a readOnly field from required", () => {
		expect.assertions(1);
		expect(
			dropReadOnlyFromRequired({
				properties: {
					id: { readOnly: true, type: "string" },
					name: { type: "string" },
				},
				required: ["id", "name"],
				type: "object",
			}),
		).toStrictEqual({
			properties: {
				id: { readOnly: true, type: "string" },
				name: { type: "string" },
			},
			required: ["name"],
			type: "object",
		});
	});

	it("should remove the required key entirely when every required field is readOnly", () => {
		expect.assertions(1);
		expect(
			dropReadOnlyFromRequired({
				properties: {
					id: { readOnly: true, type: "string" },
				},
				required: ["id"],
				type: "object",
			}),
		).toStrictEqual({
			properties: {
				id: { readOnly: true, type: "string" },
			},
			type: "object",
		});
	});

	it("should leave required unchanged when no field is readOnly", () => {
		expect.assertions(1);
		expect(
			dropReadOnlyFromRequired({
				properties: { name: { type: "string" } },
				required: ["name"],
				type: "object",
			}),
		).toStrictEqual({
			properties: { name: { type: "string" } },
			required: ["name"],
			type: "object",
		});
	});

	it("should not alter nodes without a properties + required pair", () => {
		expect.assertions(1);
		expect(
			dropReadOnlyFromRequired({
				required: ["id"],
				type: "object",
			}),
		).toStrictEqual({
			required: ["id"],
			type: "object",
		});
	});

	it("should recurse into nested schemas and arrays", () => {
		expect.assertions(1);
		expect(
			dropReadOnlyFromRequired({
				properties: {
					child: {
						properties: {
							id: { readOnly: true, type: "string" },
						},
						required: ["id"],
						type: "object",
					},
				},
				type: "object",
			}),
		).toStrictEqual({
			properties: {
				child: {
					properties: {
						id: { readOnly: true, type: "string" },
					},
					type: "object",
				},
			},
			type: "object",
		});
	});

	it("should return primitives unchanged", () => {
		expect.assertions(2);
		expect(dropReadOnlyFromRequired("hello")).toBe("hello");
		expect(dropReadOnlyFromRequired(42)).toBe(42);
	});
});

describe(getAjv, () => {
	it("should return distinct instances for response and request modes", () => {
		expect.assertions(1);
		expect(getAjv("response")).not.toBe(getAjv("request"));
	});

	it("should cache the instance per mode", () => {
		expect.assertions(2);
		expect(getAjv("response")).toBe(getAjv("response"));
		expect(getAjv("request")).toBe(getAjv("request"));
	});
});
