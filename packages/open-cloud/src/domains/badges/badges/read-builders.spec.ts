import { describe, it } from "vitest";

import { buildGetRequest } from "./builders.ts";

describe(buildGetRequest, () => {
	it("should build a GET for the badge ID", ({ expect }) => {
		expect.assertions(1);

		expect(buildGetRequest({ badgeId: "123" })).toStrictEqual({
			method: "GET",
			url: "/v1/badges/123",
		});
	});
});
