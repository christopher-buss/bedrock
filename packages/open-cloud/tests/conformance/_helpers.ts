import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, expect } from "vitest";

let cachedAjv: Ajv | undefined;

/**
 * Narrow runtime record guard used by helpers in this module.
 *
 * @param value - The value to check.
 * @returns `true` when `value` is a plain-object record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * Rewrites every OpenAPI 3.0 `nullable: true` annotation as a proper
 * JSON Schema null union, so Ajv accepts the values the upstream API
 * legitimately emits as `null`.
 *
 * For a schema with a direct `type`, the keyword becomes a type union:
 * `{ type: "string", nullable: true }` -> `{ type: ["string", "null"] }`.
 * For a schema without a direct `type` (for example an `allOf` wrapping
 * a `$ref`), the whole sub-schema is wrapped in `oneOf` with a `null`
 * branch.
 *
 * @param node - A node anywhere in the schema tree.
 * @returns The node with every `nullable: true` expressed as a null union.
 */
export function nullableToUnion(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(nullableToUnion);
	}

	if (!isRecord(node)) {
		return node;
	}

	const transformed: Record<string, unknown> = {};
	let isNullable = false;
	for (const [key, value] of Object.entries(node)) {
		if (key === "nullable") {
			if (value === true) {
				isNullable = true;
			}

			continue;
		}

		transformed[key] = nullableToUnion(value);
	}

	if (!isNullable) {
		return transformed;
	}

	const { type } = transformed;
	if (typeof type === "string") {
		return { ...transformed, type: [type, "null"] };
	}

	return { oneOf: [transformed, { type: "null" }] };
}

/**
 * Returns the ajv instance pre-loaded with the vendored
 * `roblox-openapi.json` schema and format keywords. Cached for the
 * lifetime of the test worker.
 *
 * @returns The shared ajv instance.
 */
export function getAjv(): Ajv {
	if (cachedAjv !== undefined) {
		return cachedAjv;
	}

	const ajv = new Ajv({ allErrors: true, strict: false });
	addFormats(ajv);
	ajv.addSchema(loadOpenApiDocument(), "roblox-openapi");
	cachedAjv = ajv;
	return ajv;
}

/**
 * Returns the ajv validator for a named schema from the vendored
 * OpenAPI document.
 *
 * @param schemaName - Name of the schema under
 *   `#/components/schemas/`.
 * @returns The compiled validator.
 */
export function getValidator(schemaName: string): ValidateFunction {
	const validator = getAjv().getSchema(`roblox-openapi#/components/schemas/${schemaName}`);
	assert(validator, `schema ${schemaName} not registered in vendor OpenAPI doc`);
	return validator;
}

/**
 * Asserts that a fixture body validates against the given ajv
 * validator, surfacing the error list when it does not so the test
 * fails with enough context to locate the offending field.
 *
 * @param validator - A compiled ajv validator.
 * @param fixture - The fixture body to validate.
 */
export function expectValid(validator: ValidateFunction, fixture: unknown): void {
	const isValid = validator(fixture);
	expect(isValid ? [] : (validator.errors ?? [])).toStrictEqual([]);
}

/**
 * Reads and parses a fixture JSON file from the shared
 * `tests/fixtures` tree.
 *
 * @param subdir - The resource subdirectory under `tests/fixtures/`.
 * @param name - The fixture filename.
 * @returns The parsed JSON value.
 */
export function loadFixture(subdir: string, name: string): JSONValue {
	return JSON.parse(
		readFileSync(
			fileURLToPath(new URL(`../fixtures/${subdir}/${name}`, import.meta.url)),
			"utf8",
		),
	);
}

function isWriteOnlyProperty(properties: Record<string, unknown>, field: unknown): boolean {
	if (typeof field !== "string") {
		return false;
	}

	const propertyNode = properties[field];
	return isRecord(propertyNode) && propertyNode["writeOnly"] === true;
}

function pruneWriteOnlyRequired(transformed: Record<string, unknown>): Record<string, unknown> {
	const { properties, required } = transformed;
	if (!isRecord(properties) || !Array.isArray(required)) {
		return transformed;
	}

	const pruned = required.filter((field) => !isWriteOnlyProperty(properties, field));
	if (pruned.length === required.length) {
		return transformed;
	}

	if (pruned.length === 0) {
		const { required: _required, ...rest } = transformed;
		return rest;
	}

	return { ...transformed, required: pruned };
}

/**
 * Removes any field marked `writeOnly: true` from the `required`
 * array of its containing schema so read-response fixtures are not
 * rejected for omitting a create-only input.
 *
 * @param node - A node anywhere in the schema tree.
 * @returns The node with write-only fields elided from `required`.
 */
function dropWriteOnlyFromRequired(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(dropWriteOnlyFromRequired);
	}

	if (!isRecord(node)) {
		return node;
	}

	const transformed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		transformed[key] = dropWriteOnlyFromRequired(value);
	}

	return pruneWriteOnlyRequired(transformed);
}

function loadOpenApiDocument(): Record<string, unknown> {
	const raw = JSON.parse(
		readFileSync(
			fileURLToPath(new URL("../../vendor/roblox-openapi.json", import.meta.url)),
			"utf8",
		),
	);
	const normalized = dropWriteOnlyFromRequired(nullableToUnion(raw));
	assert(isRecord(normalized));
	return normalized;
}
