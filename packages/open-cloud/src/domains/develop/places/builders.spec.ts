import { describe, it } from "vitest";

import { buildListPlacesRequest } from "./builders.ts";

describe(buildListPlacesRequest, () => {
	it("should omit the query when no pagination field is set", ({ expect }) => {
		expect.assertions(1);
		expect(buildListPlacesRequest({ universeId: "123" })).toStrictEqual({
			method: "GET",
			url: "/v1/universes/123/places",
		});
	});

	it("should map pageSize to limit and pageToken to cursor", ({ expect }) => {
		expect.assertions(1);
		expect(
			buildListPlacesRequest({ pageSize: 25, pageToken: "a+/=", universeId: "123" }),
		).toStrictEqual({
			method: "GET",
			url: "/v1/universes/123/places?limit=25&cursor=a%2B%2F%3D",
		});
	});

	it("should send the cursor alone when no page size is set", ({ expect }) => {
		expect.assertions(1);
		expect(buildListPlacesRequest({ pageToken: "c", universeId: "123" }).url).toBe(
			"/v1/universes/123/places?cursor=c",
		);
	});
});
