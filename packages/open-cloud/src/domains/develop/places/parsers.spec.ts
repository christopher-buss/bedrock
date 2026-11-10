import { assert, describe, it } from "vitest";

import { UnexpectedResponseError } from "#src/errors/unexpected-response";
import { parsePlacesListResponse } from "./parsers.ts";

const PLACE = { id: 1, name: "n", description: "d", universeId: 2 };

describe(parsePlacesListResponse, () => {
	it.for([
		[undefined, undefined],
		[JSON.parse("null"), undefined],
		["next", "next"],
	])("should normalize the next cursor %s", ([nextPageCursor, expected], { expect }) => {
		expect.assertions(1);

		const result = parsePlacesListResponse({
			body: { data: [PLACE], nextPageCursor },
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data).toStrictEqual({
			items: [{ id: "1", name: "n", description: "d", universeId: "2" }],
			nextPageToken: expected,
		});
	});

	it.for([
		[],
		{},
		{ data: {} },
		{ data: [], nextPageCursor: 1 },
		{ data: [{ ...PLACE, id: "1" }] },
		{ data: [{ ...PLACE, universeId: 1.5 }] },
		{ data: [{ ...PLACE, name: 1 }] },
		{ data: [{ ...PLACE, description: JSON.parse("null") }] },
		{ data: [1] },
	])("should reject malformed pages %#", (body, { expect }) => {
		expect.assertions(4);

		const result = parsePlacesListResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed places list response");
		expect(result.err.statusCode).toBe(200);
		expect(result.err.details).toStrictEqual(body);
	});

	it("should accept an empty page for an unknown universe", ({ expect }) => {
		expect.assertions(1);
		expect(
			parsePlacesListResponse({
				body: { data: [], nextPageCursor: JSON.parse("null") },
				headers: {},
				status: 200,
			}),
		).toStrictEqual({ data: { items: [], nextPageToken: undefined }, success: true });
	});
});
