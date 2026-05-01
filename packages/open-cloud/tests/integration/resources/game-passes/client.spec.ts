import type { OpenCloudHooks } from "#src/client/types";
import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { GamePassesClient } from "#src/resources/game-passes/index";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient, type FakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validGamePassBody } from "#tests/helpers/game-passes";
import { assert, describe, expect, it, vi } from "vitest";

function mockManyOk(fake: FakeHttpClient, count: number): FakeHttpClient {
	for (let index = 0; index < count; index++) {
		fake.mockResponse({ body: validGamePassBody(), status: 200 });
	}

	return fake;
}

describe(GamePassesClient, () => {
	describe("get", () => {
		it("should return a parsed GamePass on success", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validGamePassBody(),
				status: 200,
			});
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ gamePassId: "12345", universeId: "1" });

			assert(result.success);

			expect(result.data.id).toBe("12345");
			expect(result.data.name).toBe("Epic Pass");
		});

		it("should propagate the http error when the request fails", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({
				code: "NotFound",
				message: "Game pass not found",
				statusCode: 404,
			});
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ gamePassId: "12345", universeId: "1" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).toHaveProperty("statusCode", 404);
		});

		it("should build the request config with defaults when only apiKey is provided", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validGamePassBody(),
				status: 200,
			});
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.get({ gamePassId: "12345", universeId: "1" });

			expect(httpClient.requests[0]?.config).toStrictEqual({
				apiKey: "test-key",
				baseUrl: "https://apis.roblox.com",
				timeout: 30_000,
			});
		});

		it("should forward the configured apiKey, baseUrl, and timeout to the request config", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validGamePassBody(),
				status: 200,
			});
			const client = new GamePassesClient({
				apiKey: "configured-key",
				baseUrl: "https://staging.apis.roblox.com",
				httpClient,
				sleep: createFakeSleep(),
				timeout: 5000,
			});

			await client.get({ gamePassId: "12345", universeId: "1" });

			expect(httpClient.requests[0]?.config).toStrictEqual({
				apiKey: "configured-key",
				baseUrl: "https://staging.apis.roblox.com",
				timeout: 5000,
			});
		});

		it("should retry a 5xx error using the default retryDelay and sleep", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: validGamePassBody(), status: 200 });
			const sleep = createFakeSleep();
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.get({ gamePassId: "12345", universeId: "1" });

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(sleep.waits).toStrictEqual([1000]);
		});

		it("should sleep on the rate-limit queue once the burst allowance is exhausted", async () => {
			expect.assertions(1);

			const httpClient = mockManyOk(createFakeHttpClient(), 11);
			const clock = createFakeClock();
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			for (let index = 0; index < 11; index++) {
				await client.get({ gamePassId: "12345", universeId: "1" });
			}

			expect(clock.waits).toStrictEqual([100]);
		});

		it("should retry a 429, thread the retry wait through sleep, and fire hooks", async () => {
			expect.assertions(5);

			const httpClient = createFakeHttpClient()
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ body: validGamePassBody(), status: 200 });
			const sleep = createFakeSleep();
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const onRetry = vi.fn<NonNullable<OpenCloudHooks["onRetry"]>>();
			const onRateLimit = vi.fn<NonNullable<OpenCloudHooks["onRateLimit"]>>();
			const client = new GamePassesClient({
				apiKey: "test-key",
				hooks: { onRateLimit, onRequest, onRetry },
				httpClient,
				sleep,
			});

			const result = await client.get({ gamePassId: "12345", universeId: "1" });

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(sleep.waits).toStrictEqual([1000]);
			expect(onRequest).toHaveBeenCalledTimes(2);
			expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, expect.any(Error));
			expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(1000);
		});
	});

	describe("create", () => {
		it("should return a parsed GamePass and send a POST with a FormData body", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validGamePassBody(),
				status: 200,
			});
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.create({
				name: "Epic Pass",
				universeId: "1",
			});

			assert(result.success);

			expect(result.data.id).toBe("12345");
			expect(httpClient.requests[0]?.request.method).toBe("POST");
			expect(httpClient.requests[0]?.request.body).toBeInstanceOf(FormData);
		});

		it("should use a queue independent of get() on the same client", async () => {
			expect.assertions(1);

			const httpClient = mockManyOk(createFakeHttpClient(), 11);
			const clock = createFakeClock();
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			for (let index = 0; index < 10; index++) {
				await client.get({ gamePassId: "12345", universeId: "1" });
			}

			await client.create({ name: "Epic Pass", universeId: "1" });

			expect(clock.waits).toStrictEqual([]);
		});

		it("should not retry a 5xx so the request can't duplicate create work", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: validGamePassBody(), status: 200 });
			const sleep = createFakeSleep();
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.create({ name: "Epic Pass", universeId: "1" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(httpClient.requests).toHaveLength(1);
		});
	});

	describe("permission errors", () => {
		it("should surface a 403 on get as a PermissionError naming game-pass:read", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ gamePassId: "12345", universeId: "1" });

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["game-pass:read"]);
			expect(result.err.operationKey).toBe("game-passes.get");
		});

		it("should surface a 401 on create as a PermissionError naming game-pass:write", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 401 });
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.create({ name: "Epic Pass", universeId: "1" });

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["game-pass:write"]);
			expect(result.err.operationKey).toBe("game-passes.create");
		});
	});
});
