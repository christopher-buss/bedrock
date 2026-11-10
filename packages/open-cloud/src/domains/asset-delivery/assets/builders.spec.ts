import { describe, it } from "vitest";

import { buildLocationRequest } from "./builders.ts";

describe(buildLocationRequest, () => {
	it("should percent-encode the asset id in the path", ({ expect }) => {
		expect.assertions(1);

		expect(buildLocationRequest({ assetId: "1/../2" })).toStrictEqual({
			method: "GET",
			url: "/asset-delivery-api/v1/assetId/1%2F..%2F2",
		});
	});
});
