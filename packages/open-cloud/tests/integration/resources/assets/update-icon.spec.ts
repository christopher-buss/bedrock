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

function mockUpdate(
	httpClient: ReturnType<typeof createFakeHttpClient>,
): ReturnType<typeof createFakeHttpClient> {
	return httpClient
		.mockResponse({ body: loadFixture("assets", "update-icon-response.json"), status: 200 })
		.mockResponse({
			body: loadFixture("assets", "update-icon-operation-done-response.json"),
			status: 200,
		});
}

async function sentRequestPartAsync(
	httpClient: ReturnType<typeof createFakeHttpClient>,
): Promise<{ readonly keys: Array<string>; readonly request: JSONValue; readonly type: string }> {
	const { body } = httpClient.requests[0]!.request;
	assert(body instanceof FormData);
	const part = body.get("request");
	assert(part instanceof Blob);
	// Bun appends `;charset=utf-8` to a text part's content type; Node does not.
	const type = part.type.replace(/;charset=utf-8$/, "");
	return { keys: [...body.keys()], request: JSON.parse(await part.text()), type };
}

describe("assets updateIcon", () => {
	it("should patch only the icon and poll the operation until done", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = mockUpdate(createFakeHttpClient());

		const result = await createClient(httpClient).updateIcon({
			assetId: "456",
			iconAssetId: "789",
		});

		expect(result).toStrictEqual({ data: undefined, success: true });
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["PATCH", "/assets/v1/assets/456?updateMask=icon"],
			["GET", "/assets/v1/operations/00000000-0000-0000-0000-000000000002"],
		]);
	});

	it("should send a JSON request part naming the icon asset and no file content", async ({
		expect,
	}) => {
		expect.assertions(1);

		const httpClient = mockUpdate(createFakeHttpClient());

		await createClient(httpClient).updateIcon({ assetId: "456", iconAssetId: "789" });

		await expect(sentRequestPartAsync(httpClient)).resolves.toStrictEqual({
			keys: ["request"],
			request: { assetId: "456", icon: "assets/789" },
			type: "application/json",
		});
	});

	it("should send an empty icon to remove the icon", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = mockUpdate(createFakeHttpClient());

		await createClient(httpClient).updateIcon({ assetId: "456", iconAssetId: undefined });

		await expect(sentRequestPartAsync(httpClient)).resolves.toMatchObject({
			request: { assetId: "456", icon: "" },
		});
	});

	it("should name the asset:write scope when the credential lacks it", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });

		const result = await createClient(httpClient).updateIcon({
			assetId: "456",
			iconAssetId: "789",
		});
		assert(!result.success);
		assert(result.err instanceof PermissionError);

		expect(result.err.requiredScopes).toStrictEqual(["asset:write"]);
	});

	it("should return the poll failure", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: loadFixture("assets", "update-icon-response.json"), status: 200 })
			.mockApiError({ statusCode: 403 });

		const result = await createClient(httpClient).updateIcon({
			assetId: "456",
			iconAssetId: "789",
		});

		expect(result.success).toBeFalse();
	});

	it("should send the access token of an OAuth credential on every request", async ({
		expect,
	}) => {
		expect.assertions(1);

		const httpClient = mockUpdate(createFakeHttpClient());
		const client = new AssetsClient({
			credential: { getAccessToken: () => "token", identity: "user-1", kind: "oauth" },
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.updateIcon({ assetId: "456", iconAssetId: "789" });

		expect(httpClient.requests.map(({ config }) => config.credential)).toStrictEqual([
			{ accessToken: "token", kind: "oauth" },
			{ accessToken: "token", kind: "oauth" },
		]);
	});
});
