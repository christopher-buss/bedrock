import type { OpenCloudHooks } from "#src/client/types";
import { ApiError } from "#src/errors/api-error";
import { DeveloperProductsClient } from "#src/resources/developer-products/index";
import { validDeveloperProductBody } from "#tests/helpers/developer-products";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient, type FakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { assert, describe, expect, it, vi } from "vitest";

function mockManyOk(fake: FakeHttpClient, count: number): FakeHttpClient {
	for (let index = 0; index < count; index++) {
		fake.mockResponse({ body: validDeveloperProductBody(), status: 200 });
	}

	return fake;
}

describe(DeveloperProductsClient, () => {
	describe("get", () => {
		it("should return a parsed DeveloperProduct on success", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validDeveloperProductBody(),
				status: 200,
			});
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ productId: "12345", universeId: "999" });

			assert(result.success);

			expect(result.data.id).toBe("12345");
			expect(result.data.name).toBe("Gem Pack");
		});

		it("should propagate the http error when the request fails", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({
				code: "NotFound",
				message: "Developer product not found",
				statusCode: 404,
			});
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ productId: "12345", universeId: "999" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).toHaveProperty("statusCode", 404);
		});

		it("should retry a 5xx error using the default retryDelay and sleep", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: validDeveloperProductBody(), status: 200 });
			const sleep = createFakeSleep();
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.get({ productId: "12345", universeId: "999" });

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(sleep.waits).toStrictEqual([1000]);
		});

		it("should sleep on the rate-limit queue once the burst allowance is exhausted", async () => {
			expect.assertions(1);

			const httpClient = mockManyOk(createFakeHttpClient(), 11);
			const clock = createFakeClock();
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			for (let index = 0; index < 11; index++) {
				await client.get({ productId: "12345", universeId: "999" });
			}

			expect(clock.waits).toStrictEqual([100]);
		});

		it("should retry a 429, thread the retry wait through sleep, and fire hooks", async () => {
			expect.assertions(5);

			const httpClient = createFakeHttpClient()
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ body: validDeveloperProductBody(), status: 200 });
			const sleep = createFakeSleep();
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const onRetry = vi.fn<NonNullable<OpenCloudHooks["onRetry"]>>();
			const onRateLimit = vi.fn<NonNullable<OpenCloudHooks["onRateLimit"]>>();
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				hooks: { onRateLimit, onRequest, onRetry },
				httpClient,
				sleep,
			});

			const result = await client.get({ productId: "12345", universeId: "999" });

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(sleep.waits).toStrictEqual([1000]);
			expect(onRequest).toHaveBeenCalledTimes(2);
			expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, expect.any(Error));
			expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(1000);
		});
	});

	describe("create", () => {
		it("should return a parsed DeveloperProduct and send a POST with a FormData body", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validDeveloperProductBody(),
				status: 200,
			});
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.create({
				name: "Gem Pack",
				universeId: "999",
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
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			for (let index = 0; index < 10; index++) {
				await client.get({ productId: "12345", universeId: "999" });
			}

			await client.create({ name: "Gem Pack", universeId: "999" });

			expect(clock.waits).toStrictEqual([]);
		});

		it("should not retry a 5xx so the request can't duplicate create work", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: validDeveloperProductBody(), status: 200 });
			const sleep = createFakeSleep();
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.create({ name: "Gem Pack", universeId: "999" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(httpClient.requests).toHaveLength(1);
		});
	});

	describe("update", () => {
		it("should PATCH with a FormData body and resolve to undefined data on 204", async () => {
			expect.assertions(5);

			const httpClient = createFakeHttpClient().mockResponse({
				body: undefined,
				status: 204,
			});
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({
				name: "Gem Pack",
				description: "Premium gems",
				isForSale: true,
				price: 250,
				productId: "12345",
				universeId: "999",
			});

			assert(result.success);

			expect(result.data).toBeUndefined();
			expect(httpClient.requests).toHaveLength(1);
			expect(httpClient.requests[0]?.request.method).toBe("PATCH");
			expect(httpClient.requests[0]?.request.body).toBeInstanceOf(FormData);
			expect(httpClient.requests[0]?.request.url).toBe(
				"/developer-products/v2/universes/999/developer-products/12345",
			);
		});

		it("should propagate the http error when the PATCH fails", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({
				statusCode: 404,
			});
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({ productId: "12345", universeId: "999" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).toHaveProperty("statusCode", 404);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should retry a 5xx PATCH because update is idempotent", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: undefined, status: 204 });
			const sleep = createFakeSleep();
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.update({ productId: "12345", universeId: "999" });

			assert(result.success);

			expect(result.data).toBeUndefined();
			expect(httpClient.requests).toHaveLength(2);
			expect(sleep.waits).toStrictEqual([1000]);
		});

		it("should use a queue independent of create() on the same client", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient();
			for (let index = 0; index < 3; index++) {
				httpClient.mockResponse({ body: validDeveloperProductBody(), status: 200 });
			}

			httpClient.mockResponse({ body: undefined, status: 204 });

			const clock = createFakeClock();
			const client = new DeveloperProductsClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			for (let index = 0; index < 3; index++) {
				await client.create({ name: "Gem Pack", universeId: "999" });
			}

			await client.update({ productId: "12345", universeId: "999" });

			expect(clock.waits).toStrictEqual([]);
		});
	});
});
