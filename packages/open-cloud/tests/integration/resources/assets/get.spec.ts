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

describe("assets get", () => {
	it("should read the asset and return its id and moderation state", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient().mockResponse({
			body: loadFixture("assets", "get-place-response.json"),
			status: 200,
		});

		const result = await createClient(httpClient).get({ assetId: "456" });

		expect(result).toStrictEqual({
			data: { assetId: "456", moderationState: "Approved" },
			success: true,
		});
		expect(httpClient.requests[0]!.request).toStrictEqual({
			method: "GET",
			url: "/assets/v1/assets/456",
		});
	});

	it("should name the asset:read scope when the credential lacks it", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });

		const result = await createClient(httpClient).get({ assetId: "456" });
		assert(!result.success);
		assert(result.err instanceof PermissionError);

		expect(result.err.requiredScopes).toStrictEqual(["asset:read"]);
	});

	it("should send the access token of an OAuth credential", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockResponse({
			body: loadFixture("assets", "get-place-response.json"),
			status: 200,
		});
		const client = new AssetsClient({
			credential: { getAccessToken: () => "token", identity: "user-1", kind: "oauth" },
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.get({ assetId: "456" });

		expect(httpClient.requests[0]!.config.credential).toStrictEqual({
			accessToken: "token",
			kind: "oauth",
		});
	});
});
