import { describe, expect, it } from "vitest";

import { buildCreateRequest, buildGetRequest } from "./builders.ts";

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
