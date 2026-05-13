import { parseListLogsResponse } from "#src/domains/cloud-v2/luau-execution-task-logs/parsers";
import { parseDequeueResponse } from "#src/domains/cloud-v2/memory-store-queues/parsers";
import { parseListResponse as parseSortedMapListResponse } from "#src/domains/cloud-v2/memory-store-sorted-maps/parsers";
import { parseGamePassesListResponse } from "#src/domains/game-passes/game-passes/parsers";
import { validListGamePassesBody } from "#tests/helpers/game-passes";
import { validLogPageBody } from "#tests/helpers/luau-execution-task-logs";
import { validDequeueBody } from "#tests/helpers/memory-store-queues";
import { validListSortedMapItemsBody } from "#tests/helpers/memory-store-sorted-maps";
import { assert, describe, expect, it } from "vitest";

import { getOpenApiDocument, isRecord } from "./_helpers.ts";

/**
 * One row per list-response parser. The pin keeps three things in sync:
 *
 * - the parser's runtime behaviour (does it accept missing/null on each
 *   spec-optional field?);
 * - the OpenAPI spec (`required` array on the response schema);
 * - the wire type (whether the field is declared optional).
 *
 * Every spec-optional property must be classified into exactly one of
 * `acceptsMissingOrNull` (parser tolerates absence and JSON `null`) or
 * `stricterThanSpec` (parser keeps requiring it; rationale documents
 * why — typically because the server is stricter than the spec).
 */
interface ListParserPin {
	readonly name: string;
	readonly acceptsMissingOrNull: ReadonlyArray<string>;
	readonly parse: (body: unknown) => { readonly success: boolean };
	readonly schemaName: string;
	readonly stricterThanSpec: Readonly<Record<string, string>>;
	readonly validBody: () => Record<string, unknown>;
}

const PINS: ReadonlyArray<ListParserPin> = [
	{
		name: "parseListResponse (memory-store sorted-maps)",
		acceptsMissingOrNull: ["items", "nextPageToken"],
		parse: (body) => parseSortedMapListResponse({ body, headers: {}, status: 200 }),
		schemaName: "ListMemoryStoreSortedMapItemsResponse",
		stricterThanSpec: {},
		validBody: () => ({ ...validListSortedMapItemsBody() }),
	},
	{
		name: "parseDequeueResponse (memory-store queues)",
		acceptsMissingOrNull: ["queueItems"],
		parse: (body) => parseDequeueResponse({ body, headers: {}, status: 200 }),
		schemaName: "ReadMemoryStoreQueueItemsResponse",
		stricterThanSpec: {
			id: "Server always returns the dequeue identifier on a 200; it is the `:discard` token, so the parser keeps requiring it.",
		},
		validBody: () => ({ ...validDequeueBody() }),
	},
	{
		name: "parseListLogsResponse (luau-task-logs)",
		acceptsMissingOrNull: ["luauExecutionSessionTaskLogs", "nextPageToken"],
		parse: (body) => parseListLogsResponse({ body, headers: {}, status: 200 }),
		schemaName: "ListLuauExecutionSessionTaskLogsResponse",
		stricterThanSpec: {},
		validBody: () => ({ ...validLogPageBody() }),
	},
	{
		name: "parseGamePassesListResponse (game-passes)",
		acceptsMissingOrNull: [],
		parse: (body) => parseGamePassesListResponse({ body, headers: {}, status: 200 }),
		schemaName: "ListGamePassConfigsByUniverseResponse",
		stricterThanSpec: {},
		validBody: () => ({ ...validListGamePassesBody() }),
	},
];

interface ResponseSchemaShape {
	readonly properties: ReadonlyArray<string>;
	readonly required: ReadonlyArray<string>;
}

function loadResponseSchema(schemaName: string): ResponseSchemaShape {
	const document = getOpenApiDocument();
	const { components } = document;
	assert(isRecord(components), "OpenAPI document missing components");
	const { schemas } = components;
	assert(isRecord(schemas), "OpenAPI document missing components.schemas");
	const schema = schemas[schemaName];
	assert(isRecord(schema), `schema ${schemaName} not registered in vendor OpenAPI doc`);
	const properties = isRecord(schema["properties"]) ? Object.keys(schema["properties"]) : [];
	const required = Array.isArray(schema["required"])
		? schema["required"].filter((field): field is string => typeof field === "string")
		: [];
	return { properties, required };
}

const FIELD_ROWS: ReadonlyArray<{
	readonly field: string;
	readonly pin: ListParserPin;
	readonly pinName: string;
}> = PINS.flatMap((pin) => {
	return pin.acceptsMissingOrNull.map((field) => {
		return { field, pin, pinName: pin.name };
	});
});

describe("list-response parsers align with OpenAPI optionality", () => {
	it.for(PINS)(
		"should partition every spec-optional field of $name into acceptsMissingOrNull or stricterThanSpec",
		(pin) => {
			expect.assertions(1);

			const schema = loadResponseSchema(pin.schemaName);
			const required = new Set(schema.required);
			const specOptional = schema.properties.filter((name) => !required.has(name));
			const declared = [...pin.acceptsMissingOrNull, ...Object.keys(pin.stricterThanSpec)];

			expect([...specOptional].sort()).toStrictEqual([...declared].sort());
		},
	);

	it.for(PINS)(
		"should restrict $name acceptsMissingOrNull and stricterThanSpec to spec-optional properties",
		(pin) => {
			expect.assertions(1);

			const schema = loadResponseSchema(pin.schemaName);
			const required = new Set(schema.required);
			const properties = new Set(schema.properties);
			const offenders = [
				...pin.acceptsMissingOrNull,
				...Object.keys(pin.stricterThanSpec),
			].filter((field) => !properties.has(field) || required.has(field));

			expect(offenders).toStrictEqual([]);
		},
	);

	it.for(FIELD_ROWS)("should accept $field omitted in $pinName", ({ field, pin }) => {
		expect.assertions(1);

		const { [field]: _removed, ...rest } = pin.validBody();

		expect(pin.parse(rest).success).toBeTrue();
	});

	it.for(FIELD_ROWS)(
		"should accept $field as explicit JSON null in $pinName",
		({ field, pin }) => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...pin.validBody(),
				[field]: JSON.parse("null"),
			};

			expect(pin.parse(body).success).toBeTrue();
		},
	);
});
