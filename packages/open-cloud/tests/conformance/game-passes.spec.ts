import { parseGamePassResponse } from "#src/resources/game-passes/parsers";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const openApiDocument = stripNullable(
	JSON.parse(
		readFileSync(
			fileURLToPath(new URL("../../vendor/roblox-openapi.json", import.meta.url)),
			"utf8",
		),
	),
);
assert(isRecord(openApiDocument));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(openApiDocument, "roblox-openapi");

describe("game-passes fixtures", () => {
	it.for([
		{ fixture: "get-response.json", schema: "GamePassConfigV2" },
		{ fixture: "create-response.json", schema: "GamePassConfigV2" },
		{ fixture: "error-not-found.json", schema: "GamePasses.ErrorResponse" },
		{ fixture: "error-unauthorized.json", schema: "GamePasses.ErrorResponse" },
	])("should validate $fixture against $schema", ({ fixture, schema }) => {
		expect.assertions(1);

		const validator = getValidator(schema);
		const body = loadFixture(fixture);

		expectValid(validator, body);
	});

	describe(parseGamePassResponse, () => {
		it("should round-trip get-response.json into the public GamePass shape", () => {
			expect.assertions(1);

			const body = loadFixture("get-response.json");

			const result = parseGamePassResponse(body, 200);

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

		it("should round-trip create-response.json and collapse iconAssetId 0 to undefined", () => {
			expect.assertions(1);

			const body = loadFixture("create-response.json");

			const result = parseGamePassResponse(body, 200);

			assert(result.success);

			expect(result.data).toStrictEqual({
				id: "98765432",
				name: "Support Squad Pass",
				createdAt: new Date("2024-12-20T12:00:00.000Z"),
				description: "Back the creator and unlock bonus in-game tags.",
				iconAssetId: undefined,
				isForSale: false,
				price: {
					defaultPriceInRobux: 99,
					enabledFeatures: [],
				},
				updatedAt: new Date("2024-12-20T12:00:00.000Z"),
			});
		});
	});
});

function expectValid(validator: ValidateFunction, fixture: unknown): void {
	const isValid = validator(fixture);

	// Surface Ajv's error list so a fixture drift fails the test with
	// enough context to locate the offending field.
	expect(isValid ? [] : (validator.errors ?? [])).toStrictEqual([]);
}

function getValidator(schemaName: string): ValidateFunction {
	const validator = ajv.getSchema(`roblox-openapi#/components/schemas/${schemaName}`);
	assert(validator, `schema ${schemaName} not registered in vendor OpenAPI doc`);
	return validator;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}

function loadFixture(name: string): unknown {
	return JSON.parse(
		readFileSync(
			fileURLToPath(new URL(`../fixtures/game-passes/${name}`, import.meta.url)),
			"utf8",
		),
	);
}

/**
 * Recursively removes the OpenAPI `nullable` keyword from a schema tree.
 *
 * Ajv v8 rejects `nullable` when it sits on a schema without an explicit
 * `type` (for example an `allOf` wrapping a `$ref`, which the Roblox
 * OpenAPI uses for its nullable object properties). Our fixtures never
 * emit JSON `null`, so removing `nullable` is semantically a no-op for
 * conformance checks.
 *
 * @param node - A node anywhere in the schema tree.
 * @returns The node with all `nullable` keys removed, recursively.
 */
function stripNullable(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map((item: unknown) => stripNullable(item));
	}

	if (isRecord(node)) {
		const output: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(node)) {
			if (key === "nullable") {
				continue;
			}

			output[key] = stripNullable(value);
		}

		return output;
	}

	return node;
}
