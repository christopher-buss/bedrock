import { assert, describe, it } from "vitest";

import { parseListLogsResponse } from "#src/domains/cloud-v2/luau-execution-task-logs/parsers";
import { parseDequeueResponse } from "#src/domains/cloud-v2/memory-store-queues/parsers";
import { parseListResponse as parseSortedMapListResponse } from "#src/domains/cloud-v2/memory-store-sorted-maps/parsers";
import { parseGamePassesListResponse } from "#src/domains/game-passes/game-passes/parsers";
import { validListGamePassesBody } from "#tests/helpers/game-passes";
import { validLogPageBody } from "#tests/helpers/luau-execution-task-logs";
import { validDequeueBody } from "#tests/helpers/memory-store-queues";
import { validListSortedMapItemsBody } from "#tests/helpers/memory-store-sorted-maps";
import { getOpenApiDocument, isRecord } from "./_helpers.ts";

/**
 * One row per list-response parser. The pin keeps three things in sync:
 *
 * - the parser's runtime behaviour (missing and null are separate cases);
 * - the OpenAPI spec (`required` array on the response schema);
 * - the wire type (whether the field is declared optional).
 *
 * Every spec-optional property must be classified into exactly one of
 * `acceptsMissing` (parser tolerates absence) or
 * `stricterThanSpec` (parser keeps requiring it; rationale documents
 * why the consumer requires it). `acceptsNull` records separately proven
 * null variants; OpenAPI optionality alone never implies nullability.
 */
interface ListParserPin {
	readonly name: string;
	readonly acceptsMissing: ReadonlyArray<string>;
	readonly acceptsNull: ReadonlyArray<string>;
	readonly parse: (body: unknown) => { readonly success: boolean };
	readonly schemaName: string;
	readonly stricterThanSpec: Readonly<Record<string, string>>;
	readonly validBody: () => Record<string, unknown>;
}

const PINS: ReadonlyArray<ListParserPin> = [
	{
		name: "parseListResponse (memory-store sorted-maps)",
		acceptsMissing: ["nextPageToken"],
		acceptsNull: ["nextPageToken"],
		parse: (body) => parseSortedMapListResponse({ body, headers: {}, status: 200 }),
		schemaName: "ListMemoryStoreSortedMapItemsResponse",
		stricterThanSpec: {
			items: "The parser depends on this list field; the real empty capture has items: []. Missing or null must surface drift, not empty data.",
		},
		validBody: () => ({ ...validListSortedMapItemsBody() }),
	},
	{
		name: "parseDequeueResponse (memory-store queues)",
		acceptsMissing: [],
		acceptsNull: [],
		parse: (body) => parseDequeueResponse({ body, headers: {}, status: 200 }),
		schemaName: "ReadMemoryStoreQueueItemsResponse",
		stricterThanSpec: {
			id: "Server always returns the dequeue identifier on a 200; it is the `:discard` token, so the parser keeps requiring it.",
			queueItems:
				"Successful dequeues require an explicit list. Captured empty queues return 404 NOT_FOUND; omission or null must surface drift.",
		},
		validBody: () => ({ ...validDequeueBody() }),
	},
	{
		name: "parseListLogsResponse (luau-task-logs)",
		acceptsMissing: ["luauExecutionSessionTaskLogs", "nextPageToken"],
		acceptsNull: ["luauExecutionSessionTaskLogs", "nextPageToken"],
		parse: (body) => parseListLogsResponse({ body, headers: {}, status: 200 }),
		schemaName: "ListLuauExecutionSessionTaskLogsResponse",
		stricterThanSpec: {},
		validBody: () => ({ ...validLogPageBody() }),
	},
	{
		name: "parseGamePassesListResponse (game-passes)",
		acceptsMissing: [],
		acceptsNull: [],
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
	return pin.acceptsMissing.map((field) => {
		return { field, pin, pinName: pin.name };
	});
});

const NULL_ROWS = PINS.flatMap((pin) => {
	return pin.acceptsNull.map((field) => {
		return { field, pin, pinName: pin.name };
	});
});
const STRICT_ROWS = PINS.flatMap((pin) => {
	return Object.keys(pin.stricterThanSpec).map((field) => {
		return { field, pin, pinName: pin.name };
	});
});
const NON_NULL_ROWS = PINS.flatMap((pin) => {
	return [...pin.acceptsMissing, ...Object.keys(pin.stricterThanSpec)]
		.filter((field) => !pin.acceptsNull.includes(field))
		.map((field) => {
			return { field, pin, pinName: pin.name };
		});
});

describe("list-response parsers align with OpenAPI optionality", () => {
	it.for(STRICT_ROWS)(
		"should reject $field omitted in $pinName",
		({ field, pin }, { expect }) => {
			expect.assertions(1);

			const { [field]: _removed, ...body } = pin.validBody();

			expect(pin.parse(body).success).toBeFalse();
		},
	);

	it.for(NON_NULL_ROWS)(
		"should reject $field as JSON null in $pinName",
		({ field, pin }, { expect }) => {
			expect.assertions(1);

			const body = { ...pin.validBody(), [field]: JSON.parse("null") };

			expect(pin.parse(body).success).toBeFalse();
		},
	);

	it.for(PINS)(
		"should partition every spec-optional field of $name into acceptsMissing or stricterThanSpec",
		(pin, { expect }) => {
			expect.assertions(1);

			const schema = loadResponseSchema(pin.schemaName);
			const required = new Set(schema.required);
			const specOptional = schema.properties.filter((name) => !required.has(name));
			const declared = [...pin.acceptsMissing, ...Object.keys(pin.stricterThanSpec)];

			expect(specOptional.toSorted()).toStrictEqual(declared.toSorted());
		},
	);

	it.for(PINS)(
		"should restrict $name acceptsMissing and stricterThanSpec to spec-optional properties",
		(pin, { expect }) => {
			expect.assertions(1);

			const schema = loadResponseSchema(pin.schemaName);
			const required = new Set(schema.required);
			const properties = new Set(schema.properties);
			const pinned = [...pin.acceptsMissing, ...Object.keys(pin.stricterThanSpec)];
			const offenders = [
				...pinned.filter((field) => !properties.has(field)),
				...pinned.filter((field) => required.has(field)),
			];

			expect(offenders).toStrictEqual([]);
		},
	);

	it.for(FIELD_ROWS)("should accept $field omitted in $pinName", ({ field, pin }, { expect }) => {
		expect.assertions(1);

		const { [field]: _removed, ...rest } = pin.validBody();

		expect(pin.parse(rest).success).toBeTrue();
	});

	it.for(NULL_ROWS)(
		"should accept $field as explicit JSON null in $pinName",
		({ field, pin }, { expect }) => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...pin.validBody(),
				[field]: JSON.parse("null"),
			};

			expect(pin.parse(body).success).toBeTrue();
		},
	);
});
