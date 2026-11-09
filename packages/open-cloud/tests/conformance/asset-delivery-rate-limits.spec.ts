import { describe, it } from "vitest";

import {
	DOWNLOAD_OPERATION_LIMIT,
	DOWNLOAD_REQUIRED_SCOPES,
} from "#src/domains/asset-delivery/assets/operations";
import { getOpenApiDocument } from "./_helpers.ts";

const SECONDS_PER_MINUTE = 60;
const DECLARED_PER_MINUTE = 1000;

describe("asset delivery operation pins", () => {
	it("should pace downloads at the asset delivery route's declared rate and scope", ({
		expect,
	}) => {
		expect.assertions(2);

		expect(getOpenApiDocument()).toMatchObject({
			paths: {
				"/asset-delivery-api/v1/assetId/{assetId}": {
					get: {
						"x-roblox-rate-limits": {
							perApiKeyOwner: { maxInPeriod: DECLARED_PER_MINUTE, period: "MINUTE" },
						},
						"x-roblox-scopes": DOWNLOAD_REQUIRED_SCOPES.map((name) => ({ name })),
					},
				},
			},
		});
		expect(DOWNLOAD_OPERATION_LIMIT.maxPerSecond).toBe(
			DECLARED_PER_MINUTE / SECONDS_PER_MINUTE,
		);
	});
});
