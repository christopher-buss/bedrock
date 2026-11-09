// Captured 2026-11-09 from GET /asset-delivery-api/v1/assetId/{assetId}. The
// signed CDN path, token and request id are replaced with stable fakes.
import { assert, describe, it } from "vitest";

import { parseAssetLocationResponse } from "#src/domains/asset-delivery/assets/parsers";
import { UnexpectedResponseError } from "#src/errors/unexpected-response";
import { loadFixture } from "#tests/conformance/_helpers";

describe(parseAssetLocationResponse, () => {
	it("should parse the captured location of a readable asset", ({ expect }) => {
		expect.assertions(1);

		const result = parseAssetLocationResponse({
			body: loadFixture("asset-delivery", "location-response.json"),
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data).toBe(
			"https://contentdelivery.roblox.com/v1/bytes/sc2/00000000000000000000000000000000?__token__=exp=1700000000~acl=/v1/bytes/sc2/00000000000000000000000000000000*~hmac=0000000000000000000000000000000000000000000000000000000000000000",
		);
	});

	it.for([[], {}, { location: 1 }])("should reject a malformed body %#", (body, { expect }) => {
		expect.assertions(4);

		const result = parseAssetLocationResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed asset delivery response");
		expect(result.err).toHaveProperty("statusCode", 200);
		expect(result.err).toHaveProperty("details", body);
	});
});
