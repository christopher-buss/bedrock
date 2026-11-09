// Captured 2026-11-09 from GET
// /developer-products/v2/universes/{universeId}/developer-products/creator. IDs,
// names and descriptions are scrubbed; the final cursor is JSON null.
import { assert, describe, it } from "vitest";

import { parseProductsListResponse } from "#src/domains/developer-products/products/parsers";
import { UnexpectedResponseError } from "#src/errors/unexpected-response";
import { loadFixture } from "#tests/conformance/_helpers";
import { validDeveloperProductBody } from "#tests/helpers/developer-products";

describe(parseProductsListResponse, () => {
	it.for([
		[undefined, undefined],
		[JSON.parse("null"), undefined],
		["next", "next"],
	])("should normalize the page cursor %s", ([nextPageToken, expected], { expect }) => {
		expect.assertions(2);

		const result = parseProductsListResponse({
			body: { developerProducts: [validDeveloperProductBody()], nextPageToken },
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data.nextPageToken).toBe(expected);
		expect(result.data.items[0]).toMatchObject({
			id: "12345",
			name: "Gem Pack",
			createdAt: new Date("2024-01-15T10:30:00.000Z"),
			universeId: "999",
		});
	});

	it.for([
		[],
		{},
		{ developerProducts: {} },
		{ developerProducts: [{}] },
		{ developerProducts: [], nextPageToken: 123 },
	])("should reject malformed pages %#", (body, { expect }) => {
		expect.assertions(4);

		const result = parseProductsListResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed developer products list response");
		expect(result.err.statusCode).toBe(200);
		expect(result.err.details).toStrictEqual(body);
	});

	it("should accept an empty final page", ({ expect }) => {
		expect.assertions(1);
		expect(
			parseProductsListResponse({
				body: { developerProducts: [] },
				headers: {},
				status: 200,
			}),
		).toStrictEqual({ data: { items: [], nextPageToken: undefined }, success: true });
	});
});

describe("captured response", () => {
	it("should parse a captured live developer products response", ({ expect }) => {
		expect.assertions(3);

		const result = parseProductsListResponse({
			body: loadFixture("developer-products", "list-response.json"),
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data.items).toHaveLength(45);
		expect(result.data.items[0]).toMatchObject({
			id: "1001",
			name: "Test product 1",
			price: { defaultPriceInRobux: 50, enabledFeatures: [] },
			universeId: "123",
		});
		expect(result.data.nextPageToken).toBeUndefined();
	});
});
