import { describe, it } from "vitest";

import { buildGetRequest, buildListRequest } from "./builders.ts";

describe(buildGetRequest, () => {
	it("should build a GET for the badge ID", ({ expect }) => {
		expect.assertions(1);

		expect(buildGetRequest({ badgeId: "123" })).toStrictEqual({
			method: "GET",
			url: "/v1/badges/123",
		});
	});
});

describe(buildListRequest, () => {
	it("should leave the query off when no paging field is set", ({ expect }) => {
		expect.assertions(1);

		expect(buildListRequest({ universeId: "999" })).toStrictEqual({
			method: "GET",
			url: "/v1/universes/999/badges",
		});
	});

	it("should send pageSize as limit and pageToken as cursor", ({ expect }) => {
		expect.assertions(1);

		expect(
			buildListRequest({ pageSize: 100, pageToken: "next +/=", universeId: "999" }),
		).toStrictEqual({
			method: "GET",
			url: "/v1/universes/999/badges?limit=100&cursor=next+%2B%2F%3D",
		});
	});
});
