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
	it("should validate get-response.json against GamePassConfigV2", () => {
		expect.assertions(1);

		const validator = getValidator("GamePassConfigV2");
		const fixture = loadFixture("get-response.json");

		expectValid(validator, fixture);
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
