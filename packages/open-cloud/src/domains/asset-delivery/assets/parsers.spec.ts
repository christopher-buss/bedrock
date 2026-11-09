// Captured 2026-11-09 from GET /asset-delivery-api/v1/assetId/{assetId}. The
// signed CDN path, token and request id are replaced with stable fakes. Quirk:
// an unreadable or missing asset answers HTTP 200 with an `errors` array whose
// `code` carries the real status (409 not authorized, 404 not found).
import { assert, describe, it } from "vitest";

import { parseAssetLocationResponse } from "#src/domains/asset-delivery/assets/parsers";
import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
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

	it("should type the captured refusal of an unreadable asset as a permission error", ({
		expect,
	}) => {
		expect.assertions(2);

		const body = loadFixture("asset-delivery", "not-authorized-response.json");
		const result = parseAssetLocationResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(PermissionError);
		expect(result.err).toMatchObject({
			code: "1",
			details: body,
			message: "User is not authorized to access Asset.",
			operationKey: "assets.download",
			requiredScopes: ["legacy-asset:manage"],
			statusCode: 409,
		});
	});

	it("should type the captured miss of a non-existent asset as an api error", ({ expect }) => {
		expect.assertions(5);

		const body = loadFixture("asset-delivery", "not-found-response.json");
		const result = parseAssetLocationResponse({ body, headers: {}, status: 200 });
		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err).not.toBeInstanceOf(PermissionError);
		expect(result.err.message).toBe("Request asset was not found");
		expect(result.err.statusCode).toBe(404);
		expect(result.err.code).toBe("14");
		expect(result.err.details).toStrictEqual(body);
	});

	it("should leave the code unset when the error has no custom code", ({ expect }) => {
		expect.assertions(2);

		const result = parseAssetLocationResponse({
			body: { errors: [{ code: 500, message: "Boom" }] },
			headers: {},
			status: 200,
		});
		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.code).toBeUndefined();
	});

	it.for([
		[],
		{},
		{ location: 1 },
		{ errors: [] },
		{ errors: [{ code: "404", message: "m" }] },
		{ errors: [{ code: 404, message: 1 }] },
		{ errors: ["oops"] },
	])("should reject a malformed body %#", (body, { expect }) => {
		expect.assertions(4);

		const result = parseAssetLocationResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed asset delivery response");
		expect(result.err).toHaveProperty("statusCode", 200);
		expect(result.err).toHaveProperty("details", body);
	});
});
