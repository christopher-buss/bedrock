import { assert, describe, it } from "vitest";

import { PermissionError } from "#src/errors/permission-error";
import { PollTimeoutError } from "#src/errors/poll-timeout";
import { UnexpectedResponseError } from "#src/errors/unexpected-response";
import { AssetOperationError, AssetsClient } from "#src/resources/assets/index";
import { loadFixture } from "#tests/conformance/_helpers";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep, type FakeSleep } from "#tests/helpers/fake-sleep";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const OPERATION_URL = "/assets/v1/operations/00000000-0000-0000-0000-000000000001";

const IMAGE = {
	contentType: "image/png",
	creator: { userId: "111" },
	displayName: "Test Icon",
	fileContent: PNG,
} as const;

function createClient(
	httpClient: ReturnType<typeof createFakeHttpClient>,
	sleep: FakeSleep = createFakeSleep(),
): AssetsClient {
	return new AssetsClient({ credential: { apiKey: "key", kind: "apiKey" }, httpClient, sleep });
}

function mockFixture(
	httpClient: ReturnType<typeof createFakeHttpClient>,
	fixture: string,
): ReturnType<typeof createFakeHttpClient> {
	return httpClient.mockResponse({ body: loadFixture("assets", fixture), status: 200 });
}

function formOf(httpClient: ReturnType<typeof createFakeHttpClient>): FormData {
	const { body } = httpClient.requests[0]!.request;
	assert(body instanceof FormData);
	return body;
}

function requestPartOf(form: FormData): JSONValue {
	const part = form.get("request");
	assert(typeof part === "string");
	return JSON.parse(part);
}

describe("assets createImage", () => {
	it("should poll the operation until done and return the new image", async ({ expect }) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-response.json");
		mockFixture(httpClient, "create-image-operation-done-response.json");
		const sleep = createFakeSleep();

		const result = await createClient(httpClient, sleep).createImage(IMAGE);

		expect(result).toStrictEqual({
			data: { assetId: "789", moderationState: "Approved" },
			success: true,
		});
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["POST", "/assets/v1/assets"],
			["GET", OPERATION_URL],
		]);
		expect(sleep.waits).toStrictEqual([]);
	});

	it("should keep polling while the operation is not done", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-response.json");
		mockFixture(httpClient, "create-image-response.json");
		mockFixture(httpClient, "create-image-operation-done-response.json");
		const sleep = createFakeSleep();

		const result = await createClient(httpClient, sleep).createImage(IMAGE);

		expect([result.success, sleep.waits]).toStrictEqual([true, [500]]);
	});

	it("should return without polling when the create answers a done operation", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-operation-done-response.json");

		const result = await createClient(httpClient).createImage(IMAGE);

		expect(result.success).toBeTrue();
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should send an open-use image request part and the file content", async ({ expect }) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-operation-done-response.json");

		await createClient(httpClient).createImage({ ...IMAGE, description: "An icon" });

		const form = formOf(httpClient);
		const file = form.get("fileContent");
		assert(file instanceof File);

		expect(requestPartOf(form)).toStrictEqual({
			assetType: "Image",
			creationContext: { assetPrivacy: "OpenUse", creator: { userId: "111" } },
			description: "An icon",
			displayName: "Test Icon",
		});
		expect([file.name, file.type]).toStrictEqual(["image.png", "image/png"]);
		expect(new Uint8Array(await file.arrayBuffer())).toStrictEqual(PNG);
	});

	it("should send an empty description and a group creator when given", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-operation-done-response.json");

		await createClient(httpClient).createImage({ ...IMAGE, creator: { groupId: "222" } });

		expect(requestPartOf(formOf(httpClient))).toMatchObject({
			creationContext: { creator: { groupId: "222" } },
			description: "",
		});
	});

	it.for([
		["image/bmp", "image.bmp"],
		["image/jpeg", "image.jpg"],
		["image/tga", "image.tga"],
	] as const)("should name a %s file %s", async ([contentType, name], { expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-operation-done-response.json");

		await createClient(httpClient).createImage({ ...IMAGE, contentType });

		const file = formOf(httpClient).get("fileContent");
		assert(file instanceof File);

		expect([file.name, file.type]).toStrictEqual([name, contentType]);
	});

	it("should return an asset operation error when the operation fails", async ({ expect }) => {
		expect.assertions(4);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-response.json");
		mockFixture(httpClient, "create-image-operation-failed-response.json");

		const result = await createClient(httpClient).createImage(IMAGE);
		assert(!result.success);
		assert(result.err instanceof AssetOperationError);

		expect(result.err.message).toBe(
			"Asset operation 00000000-0000-0000-0000-000000000001 failed: The image could not be processed.",
		);
		expect(result.err.code).toBe("INVALID_ARGUMENT");
		expect(result.err.operationId).toBe("00000000-0000-0000-0000-000000000001");
		expect(result.err.name).toBe("AssetOperationError");
	});

	it("should return an unexpected response error when the done operation holds no asset", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { done: true, operationId: "00000000-0000-0000-0000-000000000001", response: {} },
			status: 200,
		});

		const result = await createClient(httpClient).createImage(IMAGE);
		assert(!result.success);
		assert(result.err instanceof UnexpectedResponseError);

		expect(result.err.message).toStartWith("Malformed asset response");
		expect(result.err.statusCode).toBe(200);
		expect(result.err.details).toStrictEqual({});
	});

	it("should return the create failure without polling", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });

		const result = await createClient(httpClient).createImage(IMAGE);
		assert(!result.success);
		assert(result.err instanceof PermissionError);

		expect(result.err.requiredScopes).toStrictEqual(["asset:write"]);
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should name the asset:write scope when a poll is refused", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-response.json");
		httpClient.mockApiError({ statusCode: 403 });

		const result = await createClient(httpClient).createImage(IMAGE);
		assert(!result.success);
		assert(result.err instanceof PermissionError);

		expect(result.err.requiredScopes).toStrictEqual(["asset:write"]);
	});

	it("should stop polling with a poll timeout once the budget is spent", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-response.json");

		const result = await createClient(httpClient).createImage(IMAGE, { timeoutMs: 0 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(PollTimeoutError);
	});

	it("should send the access token of an OAuth credential on every request", async ({
		expect,
	}) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient();
		mockFixture(httpClient, "create-image-response.json");
		mockFixture(httpClient, "create-image-operation-done-response.json");
		const client = new AssetsClient({
			credential: { getAccessToken: () => "token", identity: "user-1", kind: "oauth" },
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.createImage(IMAGE);

		expect(httpClient.requests.map(({ config }) => config.credential)).toStrictEqual([
			{ accessToken: "token", kind: "oauth" },
			{ accessToken: "token", kind: "oauth" },
		]);
	});
});
