import { assert, describe, expect, it } from "vitest";

import { parseLuauExecutionTaskResponse } from "#src/domains/cloud-v2/luau-execution-tasks/parsers";
import { getOpenApiDocument, isRecord, loadFixture } from "./_helpers.ts";

// The vendored `LuauExecutionSessionTask` schema declares `timeout` as
// `format: "duration"` (ISO 8601 e.g. `"PT3S"`), but the upstream
// example and the live server both emit `"<n>s"` (e.g. `"3s"`). Ajv
// rejects the live shape against the declared format, so unlike the
// other resource specs this file does not run the schema validator
// against the recorded fixtures; the parser round-trip below covers
// the divergence between hand-built test bodies and the live wire.

describe("luau-execution-tasks fixtures", () => {
	describe(parseLuauExecutionTaskResponse, () => {
		it("should round-trip submit-response-processing.json into an in-progress task whose timestamps are undefined", () => {
			expect.assertions(5);

			const body = loadFixture("luau-execution-tasks", "submit-response-processing.json");

			const result = parseLuauExecutionTaskResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.state).toBe("PROCESSING");
			expect(result.data.user).toBe("1910140");
			expect(result.data.timeoutSeconds).toBe(60);
			expect(result.data.createdAt).toBeUndefined();
			expect(result.data.updatedAt).toBeUndefined();
		});

		it("should round-trip get-response-complete.json into a COMPLETE task whose timestamps and output are surfaced", () => {
			expect.assertions(4);

			const body = loadFixture("luau-execution-tasks", "get-response-complete.json");

			const result = parseLuauExecutionTaskResponse({ body, headers: {}, status: 200 });

			assert(result.success);
			assert(result.data.state === "COMPLETE");

			expect(result.data.output.results).toStrictEqual([1]);
			expect(result.data.createdAt).toStrictEqual(new Date("2026-05-12T01:42:25.171Z"));
			expect(result.data.updatedAt).toStrictEqual(new Date("2026-05-12T01:42:26.443Z"));
			expect(result.data.timeoutSeconds).toBe(60);
		});
	});
});

/**
 * Reads one string enum declared on a vendored component schema.
 *
 * @param schemaName - Name under `#/components/schemas/`.
 * @param property - Property on that schema carrying the enum.
 * @returns The declared enum members, in schema order.
 */
function schemaEnum(schemaName: string, property: string): ReadonlyArray<string> {
	const { components } = getOpenApiDocument();
	assert(isRecord(components), "OpenAPI document missing components");
	const { schemas } = components;
	assert(isRecord(schemas), "OpenAPI document missing components.schemas");
	const schema = schemas[schemaName];
	assert(isRecord(schema), `OpenAPI document missing schema ${schemaName}`);
	const { properties } = schema;
	assert(isRecord(properties), `Schema ${schemaName} missing properties`);
	const node = properties[property];
	assert(isRecord(node), `Schema ${schemaName} missing property ${property}`);
	const members = node["enum"];
	assert(Array.isArray(members), `Schema ${schemaName}.${property} declares no enum`);

	return members.map(String);
}

describe("declared enum conformance", () => {
	it.for(schemaEnum("LuauExecutionSessionTask", "state"))(
		"should accept the schema-declared task state %s",
		(state) => {
			expect.assertions(1);

			const result = parseLuauExecutionTaskResponse({
				body: {
					error: { code: "SCRIPT_ERROR", message: "oops" },
					output: { results: [] },
					path: "universes/123/places/456/luau-execution-session-tasks/task-1",
					state,
					user: "user-1",
				},
				headers: {},
				status: 200,
			});

			assert(result.success);

			expect(result.data.state).toBe(state);
		},
	);

	it.for(schemaEnum("LuauExecutionSessionTask_Error", "code"))(
		"should accept the schema-declared task error code %s",
		(code) => {
			expect.assertions(1);

			const result = parseLuauExecutionTaskResponse({
				body: {
					error: { code, message: "oops" },
					path: "universes/123/places/456/luau-execution-session-tasks/task-1",
					state: "FAILED",
					user: "user-1",
				},
				headers: {},
				status: 200,
			});

			assert(result.success);
			assert(result.data.state === "FAILED");

			expect(result.data.error.code).toBe(code);
		},
	);
});
