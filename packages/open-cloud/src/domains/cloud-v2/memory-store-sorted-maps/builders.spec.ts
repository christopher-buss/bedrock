import { describe, expect, it } from "vitest";

import {
	buildCreateRequest,
	buildDeleteRequest,
	buildGetRequest,
	buildListRequest,
	buildUpdateRequest,
} from "./builders.ts";

describe(buildCreateRequest, () => {
	it("should produce a POST request targeting /cloud/v2/universes/{uid}/memory-store/sorted-maps/{mid}/items", () => {
		expect.assertions(2);

		const request = buildCreateRequest({
			itemId: "item-1",
			mapId: "my-map",
			universeId: "123",
			value: "hello",
		});

		expect(request.method).toBe("POST");
		expect(request.url).toBe(
			"/cloud/v2/universes/123/memory-store/sorted-maps/my-map/items?id=item-1",
		);
	});

	it("should send application/json as the content-type header", () => {
		expect.assertions(1);

		const request = buildCreateRequest({
			itemId: "i",
			mapId: "m",
			universeId: "1",
			value: "x",
		});

		expect(request.headers).toStrictEqual({ "content-type": "application/json" });
	});

	it("should serialize value verbatim into the JSON body", () => {
		expect.assertions(1);

		const value = JSON.parse('{"foo":1,"nested":[true,null]}');

		const request = buildCreateRequest({
			itemId: "i",
			mapId: "m",
			universeId: "1",
			value,
		});

		expect(request.body).toStrictEqual({ value });
	});

	it("should allow value to be JSON null at the top level", () => {
		expect.assertions(1);

		const request = buildCreateRequest({
			itemId: "i",
			mapId: "m",
			universeId: "1",
			value: JSON.parse("null"),
		});

		expect(request.body).toStrictEqual({ value: JSON.parse("null") });
	});

	it("should preserve a falsy value (zero) in the body", () => {
		expect.assertions(1);

		const request = buildCreateRequest({
			itemId: "i",
			mapId: "m",
			universeId: "1",
			value: 0,
		});

		expect(request.body).toStrictEqual({ value: 0 });
	});

	it("should serialize ttl as a duration string in seconds when supplied", () => {
		expect.assertions(1);

		const request = buildCreateRequest({
			itemId: "i",
			mapId: "m",
			ttl: 30,
			universeId: "1",
			value: "x",
		});

		expect(request.body).toStrictEqual({ ttl: "30s", value: "x" });
	});

	it("should project a string sort key into stringSortKey on the body", () => {
		expect.assertions(1);

		const request = buildCreateRequest({
			itemId: "i",
			mapId: "m",
			sortKey: { kind: "string", value: "alpha" },
			universeId: "1",
			value: "x",
		});

		expect(request.body).toStrictEqual({ stringSortKey: "alpha", value: "x" });
	});

	it("should project a numeric sort key into numericSortKey on the body", () => {
		expect.assertions(1);

		const request = buildCreateRequest({
			itemId: "i",
			mapId: "m",
			sortKey: { kind: "numeric", value: 42 },
			universeId: "1",
			value: "x",
		});

		expect(request.body).toStrictEqual({ numericSortKey: 42, value: "x" });
	});

	it("should omit ttl and sort-key fields when not supplied", () => {
		expect.assertions(1);

		const request = buildCreateRequest({
			itemId: "i",
			mapId: "m",
			universeId: "1",
			value: "x",
		});

		expect(request.body).toStrictEqual({ value: "x" });
	});

	it("should URL-encode an itemId carrying reserved characters", () => {
		expect.assertions(1);

		const request = buildCreateRequest({
			itemId: "Hello world!?",
			mapId: "m",
			universeId: "1",
			value: "x",
		});

		expect(request.url).toBe(
			"/cloud/v2/universes/1/memory-store/sorted-maps/m/items?id=Hello+world%21%3F",
		);
	});
});

describe(buildDeleteRequest, () => {
	it("should produce a DELETE request targeting /cloud/v2/universes/{uid}/memory-store/sorted-maps/{mid}/items/{iid}", () => {
		expect.assertions(2);

		const request = buildDeleteRequest({
			itemId: "item-1",
			mapId: "my-map",
			universeId: "123",
		});

		expect(request.method).toBe("DELETE");
		expect(request.url).toBe(
			"/cloud/v2/universes/123/memory-store/sorted-maps/my-map/items/item-1",
		);
	});

	it("should not carry a body or content-type", () => {
		expect.assertions(2);

		const request = buildDeleteRequest({ itemId: "i", mapId: "m", universeId: "1" });

		expect(request.body).toBeUndefined();
		expect(request.headers).toBeUndefined();
	});

	it("should URL-encode an itemId carrying reserved characters in the path", () => {
		expect.assertions(1);

		const request = buildDeleteRequest({
			itemId: "Hello world!?",
			mapId: "m",
			universeId: "1",
		});

		expect(request.url).toBe(
			"/cloud/v2/universes/1/memory-store/sorted-maps/m/items/Hello%20world!%3F",
		);
	});
});

describe(buildListRequest, () => {
	it("should produce a GET request targeting /cloud/v2/universes/{uid}/memory-store/sorted-maps/{mid}/items", () => {
		expect.assertions(2);

		const request = buildListRequest({ mapId: "my-map", universeId: "123" });

		expect(request.method).toBe("GET");
		expect(request.url).toBe("/cloud/v2/universes/123/memory-store/sorted-maps/my-map/items");
	});

	it("should not carry a body or content-type", () => {
		expect.assertions(2);

		const request = buildListRequest({ mapId: "m", universeId: "1" });

		expect(request.body).toBeUndefined();
		expect(request.headers).toBeUndefined();
	});

	it("should serialize maxPageSize, pageToken, orderBy, and filter into the query string", () => {
		expect.assertions(1);

		const request = buildListRequest({
			filter: 'id > "key-001"',
			mapId: "m",
			maxPageSize: 50,
			orderBy: "id desc",
			pageToken: "tok-123",
			universeId: "1",
		});

		expect(request.url).toBe(
			"/cloud/v2/universes/1/memory-store/sorted-maps/m/items?maxPageSize=50&pageToken=tok-123&orderBy=id+desc&filter=id+%3E+%22key-001%22",
		);
	});

	it("should omit query keys for parameters not supplied", () => {
		expect.assertions(2);

		const request = buildListRequest({
			mapId: "m",
			maxPageSize: 10,
			universeId: "1",
		});

		expect(request.url).toContain("?maxPageSize=10");
		expect(request.url).not.toContain("pageToken");
	});
});

describe(buildUpdateRequest, () => {
	it("should produce a PATCH request targeting /cloud/v2/universes/{uid}/memory-store/sorted-maps/{mid}/items/{iid}", () => {
		expect.assertions(2);

		const request = buildUpdateRequest({
			itemId: "item-1",
			mapId: "my-map",
			universeId: "123",
		});

		expect(request.method).toBe("PATCH");
		expect(request.url).toBe(
			"/cloud/v2/universes/123/memory-store/sorted-maps/my-map/items/item-1",
		);
	});

	it("should send application/json as the content-type header", () => {
		expect.assertions(1);

		const request = buildUpdateRequest({ itemId: "i", mapId: "m", universeId: "1" });

		expect(request.headers).toStrictEqual({ "content-type": "application/json" });
	});

	it("should send an empty body when no body fields are supplied", () => {
		expect.assertions(1);

		const request = buildUpdateRequest({ itemId: "i", mapId: "m", universeId: "1" });

		expect(request.body).toStrictEqual({});
	});

	it("should include value in the body when supplied", () => {
		expect.assertions(1);

		const request = buildUpdateRequest({
			itemId: "i",
			mapId: "m",
			universeId: "1",
			value: { score: 5 },
		});

		expect(request.body).toStrictEqual({ value: { score: 5 } });
	});

	it("should serialize ttl as a duration string in seconds when supplied", () => {
		expect.assertions(1);

		const request = buildUpdateRequest({
			itemId: "i",
			mapId: "m",
			ttl: 30,
			universeId: "1",
		});

		expect(request.body).toStrictEqual({ ttl: "30s" });
	});

	it("should project a string sort key into stringSortKey on the body", () => {
		expect.assertions(1);

		const request = buildUpdateRequest({
			itemId: "i",
			mapId: "m",
			sortKey: { kind: "string", value: "alpha" },
			universeId: "1",
		});

		expect(request.body).toStrictEqual({ stringSortKey: "alpha" });
	});

	it("should project a numeric sort key into numericSortKey on the body", () => {
		expect.assertions(1);

		const request = buildUpdateRequest({
			itemId: "i",
			mapId: "m",
			sortKey: { kind: "numeric", value: 7 },
			universeId: "1",
		});

		expect(request.body).toStrictEqual({ numericSortKey: 7 });
	});

	it("should append allowMissing as a boolean query string when supplied", () => {
		expect.assertions(1);

		const request = buildUpdateRequest({
			allowMissing: true,
			itemId: "i",
			mapId: "m",
			universeId: "1",
		});

		expect(request.url).toBe(
			"/cloud/v2/universes/1/memory-store/sorted-maps/m/items/i?allowMissing=true",
		);
	});

	it("should send allowMissing=false explicitly when supplied as false", () => {
		expect.assertions(1);

		const request = buildUpdateRequest({
			allowMissing: false,
			itemId: "i",
			mapId: "m",
			universeId: "1",
		});

		expect(request.url).toBe(
			"/cloud/v2/universes/1/memory-store/sorted-maps/m/items/i?allowMissing=false",
		);
	});

	it("should URL-encode an itemId carrying reserved characters in the path", () => {
		expect.assertions(1);

		const request = buildUpdateRequest({
			itemId: "Hello world!?",
			mapId: "m",
			universeId: "1",
		});

		expect(request.url).toBe(
			"/cloud/v2/universes/1/memory-store/sorted-maps/m/items/Hello%20world!%3F",
		);
	});
});

describe(buildGetRequest, () => {
	it("should produce a GET request targeting /cloud/v2/universes/{uid}/memory-store/sorted-maps/{mid}/items/{iid}", () => {
		expect.assertions(2);

		const request = buildGetRequest({
			itemId: "item-1",
			mapId: "my-map",
			universeId: "123",
		});

		expect(request.method).toBe("GET");
		expect(request.url).toBe(
			"/cloud/v2/universes/123/memory-store/sorted-maps/my-map/items/item-1",
		);
	});

	it("should not carry a body or content-type", () => {
		expect.assertions(2);

		const request = buildGetRequest({ itemId: "i", mapId: "m", universeId: "1" });

		expect(request.body).toBeUndefined();
		expect(request.headers).toBeUndefined();
	});

	it("should URL-encode an itemId carrying reserved characters in the path", () => {
		expect.assertions(1);

		const request = buildGetRequest({
			itemId: "Hello world!?",
			mapId: "m",
			universeId: "1",
		});

		expect(request.url).toBe(
			"/cloud/v2/universes/1/memory-store/sorted-maps/m/items/Hello%20world!%3F",
		);
	});
});
