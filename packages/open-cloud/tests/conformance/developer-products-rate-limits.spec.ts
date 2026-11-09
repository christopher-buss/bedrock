import { describe, it } from "vitest";

import { LIST_OPERATION_LIMIT } from "#src/domains/developer-products/products/operations";
import { getOpenApiDocument } from "./_helpers.ts";

describe("developer products list rate limit", () => {
	it("should pace listing at its own operation's declared rate", ({ expect }) => {
		expect.assertions(1);
		expect(getOpenApiDocument()).toMatchObject({
			paths: {
				"/developer-products/v2/universes/{universeId}/developer-products/creator": {
					get: {
						"operationId": "DeveloperProducts_ListDeveloperProductConfigsByUniverseV2",
						"x-roblox-rate-limits": {
							perApiKeyOwner: {
								maxInPeriod: LIST_OPERATION_LIMIT.maxPerSecond,
								period: "SECOND",
							},
						},
					},
				},
			},
		});
	});
});
