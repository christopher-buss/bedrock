import { isRecord } from "#src/internal/utils/is-record";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, expect } from "vitest";

/**
 * Normalization mode for the Ajv instance returned by {@link getAjv}.
 *
 * - `"response"` prunes `writeOnly` fields from `required`, so read-response
 *   fixtures are not rejected for omitting a create-only input.
 * - `"request"` prunes `readOnly` fields from `required`, so request-body
 *   fixtures are not rejected for omitting a server-assigned field.
 */
export type OpenApiValidationMode = "request" | "response";

const cachedAjv: Partial<Record<OpenApiValidationMode, Ajv>> = {};

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
 * Removes any field marked `readOnly: true` from the `required` array
 * of its containing schema so request-body fixtures are not rejected
 * for omitting a server-assigned field like `id` or `createdAt`.
 *
 * @param node - A node anywhere in the schema tree.
 * @returns The node with read-only fields elided from `required`.
 */
export function dropReadOnlyFromRequired(node: unknown): unknown {
	return dropFlagFromRequired(node, "readOnly");
}

/**
 * Replaces every property marked `readOnly: true` with the never-match
 * schema `{ not: {} }`, and removes the property from any enclosing
 * `required` array. The OpenAPI spec defines `readOnly: true` as
 * "MUST NOT be sent in request bodies" but Ajv treats the keyword as
 * pure metadata; without this rewrite a request validator accepts
 * readOnly fields it should reject.
 *
 * @param node - A node anywhere in the schema tree.
 * @returns The node with readOnly properties rewritten to `{ not: {} }`.
 */
export function forbidReadOnlyProperties(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(forbidReadOnlyProperties);
	}

	if (!isRecord(node)) {
		return node;
	}

	const transformed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		transformed[key] = forbidReadOnlyProperties(value);
	}

	return rewriteReadOnlyProperties(transformed);
}

/**
 * Returns the ajv instance pre-loaded with the vendored
 * `roblox-openapi.json` schema and format keywords. Cached per mode
 * for the lifetime of the test worker.
 *
 * `"response"` prunes `writeOnly` fields from `required`; `"request"`
 * prunes `readOnly` fields from `required`. The two trees are
 * independent Ajv instances.
 *
 * @param mode - Which normalization to apply to the schema tree.
 * @returns The shared ajv instance for that mode.
 */
export function getAjv(mode: OpenApiValidationMode): Ajv {
	const cached = cachedAjv[mode];
	if (cached !== undefined) {
		return cached;
	}

	const ajv = new Ajv({ allErrors: true, strict: false });
	addFormats(ajv);
	ajv.addSchema(loadOpenApiDocument(mode), "roblox-openapi");
	cachedAjv[mode] = ajv;
	return ajv;
}

/**
 * Returns the ajv validator for a named schema from the vendored
 * OpenAPI document, resolved against the response-mode schema tree.
 *
 * @param schemaName - Name of the schema under
 *   `#/components/schemas/`.
 * @returns The compiled validator.
 */
export function getValidator(schemaName: string): ValidateFunction {
	const validator = getAjv("response").getSchema(
		`roblox-openapi#/components/schemas/${schemaName}`,
	);
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

function pruneRequired(
	transformed: Record<string, unknown>,
	flag: "readOnly" | "writeOnly",
): Record<string, unknown> {
	const { properties, required } = transformed;
	if (!isRecord(properties) || !Array.isArray(required)) {
		return transformed;
	}

	const pruned = required.filter((field) => {
		if (typeof field !== "string") {
			return true;
		}

		const propertyNode = properties[field];
		return !isRecord(propertyNode) || propertyNode[flag] !== true;
	});
	if (pruned.length === required.length) {
		return transformed;
	}

	if (pruned.length === 0) {
		const { required: _required, ...rest } = transformed;
		return rest;
	}

	return { ...transformed, required: pruned };
}

function dropFlagFromRequired(node: unknown, flag: "readOnly" | "writeOnly"): unknown {
	if (Array.isArray(node)) {
		return node.map((child) => dropFlagFromRequired(child, flag));
	}

	if (!isRecord(node)) {
		return node;
	}

	const transformed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		transformed[key] = dropFlagFromRequired(value, flag);
	}

	return pruneRequired(transformed, flag);
}

function pruneRequiredKeys(
	node: Record<string, unknown>,
	keysToRemove: ReadonlySet<string>,
): Record<string, unknown> {
	const { required } = node;
	if (!Array.isArray(required)) {
		return node;
	}

	const pruned = required.filter(
		(field) => typeof field !== "string" || !keysToRemove.has(field),
	);
	if (pruned.length === required.length) {
		return node;
	}

	if (pruned.length === 0) {
		const { required: _required, ...rest } = node;
		return rest;
	}

	return { ...node, required: pruned };
}

function rewriteReadOnlyProperties(node: Record<string, unknown>): Record<string, unknown> {
	const { properties } = node;
	if (!isRecord(properties)) {
		return node;
	}

	const rewrittenProperties: Record<string, unknown> = {};
	const readOnlyKeys = new Set<string>();
	for (const [propertyKey, propertyNode] of Object.entries(properties)) {
		if (isRecord(propertyNode) && propertyNode["readOnly"] === true) {
			readOnlyKeys.add(propertyKey);
			rewrittenProperties[propertyKey] = { not: {} };
			continue;
		}

		rewrittenProperties[propertyKey] = propertyNode;
	}

	if (readOnlyKeys.size === 0) {
		return node;
	}

	return pruneRequiredKeys({ ...node, properties: rewrittenProperties }, readOnlyKeys);
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
	return dropFlagFromRequired(node, "writeOnly");
}

let cachedRawDocument: Record<string, unknown> | undefined;

/**
 * Returns the untouched vendored OpenAPI document, cached for the
 * lifetime of the test worker. Consumers that only need to walk
 * `paths` and pluck operation metadata should use this instead of
 * {@link getAjv}; validation-side refs resolve against the Ajv tree
 * that matches their normalization mode.
 *
 * @returns The parsed OpenAPI document.
 */
export function getOpenApiDocument(): Record<string, unknown> {
	if (cachedRawDocument !== undefined) {
		return cachedRawDocument;
	}

	const raw = JSON.parse(
		readFileSync(
			fileURLToPath(new URL("../../vendor/roblox-openapi.json", import.meta.url)),
			"utf8",
		),
	);
	assert(isRecord(raw));
	cachedRawDocument = raw;
	return raw;
}

function loadOpenApiDocument(mode: OpenApiValidationMode): Record<string, unknown> {
	const nullFixed = nullableToUnion(getOpenApiDocument());
	// Request-mode rewrites readOnly properties into the never-match
	// schema `{ not: {} }` so a request body that includes them fails
	// validation, and strips writeOnly fields from `required` because
	// the Roblox spec reuses one schema for create and update (a PATCH
	// body cannot supply create-only writeOnly fields like
	// `templateRootPlace`).
	const normalized =
		mode === "response"
			? dropWriteOnlyFromRequired(nullFixed)
			: dropWriteOnlyFromRequired(forbidReadOnlyProperties(nullFixed));
	assert(isRecord(normalized));
	return normalized;
}

export { isRecord } from "#src/internal/utils/is-record";
