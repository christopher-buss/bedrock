import { assert, describe, it } from "vitest";

import { PermissionError } from "#src/errors/permission-error";
import { AssetsClient } from "#src/resources/assets/index";
import { loadFixture } from "#tests/conformance/_helpers";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

function createClient(httpClient: ReturnType<typeof createFakeHttpClient>): AssetsClient {
	return new AssetsClient({
		credential: { apiKey: "key", kind: "apiKey" },
		httpClient,
		sleep: createFakeSleep(),
	});
}

describe("assets getIcon", () => {
	it("should read the icon with an icon read mask and return the image asset id", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient().mockResponse({
			body: loadFixture("assets", "get-place-icon-response.json"),
			status: 200,
		});

		const result = await createClient(httpClient).getIcon({ assetId: "456" });

		expect(result).toStrictEqual({ data: "789", success: true });
		expect(httpClient.requests[0]!.request).toStrictEqual({
			method: "GET",
			url: "/assets/v1/assets/456?readMask=icon",
		});
	});

	it("should report no icon for an asset without one", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockResponse({
			body: loadFixture("assets", "get-place-icon-empty-response.json"),
			status: 200,
		});

		const result = await createClient(httpClient).getIcon({ assetId: "456" });

		expect(result).toStrictEqual({ data: undefined, success: true });
	});

	it("should name the asset:read scope when the credential lacks it", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });

		const result = await createClient(httpClient).getIcon({ assetId: "456" });
		assert(!result.success);
		assert(result.err instanceof PermissionError);

		expect(result.err.requiredScopes).toStrictEqual(["asset:read"]);
	});

	it("should send the access token of an OAuth credential", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockResponse({
			body: loadFixture("assets", "get-place-icon-response.json"),
			status: 200,
		});
		const client = new AssetsClient({
			credential: { getAccessToken: () => "token", identity: "user-1", kind: "oauth" },
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.getIcon({ assetId: "456" });

		expect(httpClient.requests[0]!.config.credential).toStrictEqual({
			accessToken: "token",
			kind: "oauth",
		});
	});
});
