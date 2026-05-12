import type { OpenCloudHooks } from "#src/client/types";
import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { BadgesClient } from "#src/resources/badges/index";
import { validBadgeBody } from "#tests/helpers/badges";
import { createFakeClock } from "#tests/helpers/fake-clock";
import {
	createFakeHttpClient,
	type FakeHttpClient,
} from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { assert, describe, expect, it, vi } from "vitest";

function mockManyOk(fake: FakeHttpClient, count: number): FakeHttpClient {
	for (let index = 0; index < count; index++) {
		fake.mockResponse({ body: validBadgeBody(), status: 200 });
	}

	return fake;
}

const ICON_BYTES = new Uint8Array([1, 2, 3]);

describe(BadgesClient, () => {
	describe("create", () => {
		it("should return a parsed Badge and send a POST with a FormData body", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validBadgeBody(),
				status: 200,
			});
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.create({
				name: "First Goal",
				icon: ICON_BYTES,
				universeId: "999",
			});

			assert(result.success);

			expect(result.data.id).toBe("12345");
			expect(httpClient.requests[0]?.request.method).toBe("POST");
			expect(httpClient.requests[0]?.request.url).toBe(
				"/legacy-badges/v1/universes/999/badges",
			);
			expect(httpClient.requests[0]?.request.body).toBeInstanceOf(FormData);
		});

		it("should propagate the http error when the request fails", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({
				message: "Universe not found",
				statusCode: 404,
			});
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.create({
				name: "First Goal",
				icon: ICON_BYTES,
				universeId: "999",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).toHaveProperty("statusCode", 404);
		});

		it("should not retry a 5xx so the request can't duplicate create work", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: validBadgeBody(), status: 200 });
			const sleep = createFakeSleep();
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.create({
				name: "First Goal",
				icon: ICON_BYTES,
				universeId: "999",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should retry a 429, thread the retry wait through sleep, and fire hooks", async () => {
			expect.assertions(5);

			const httpClient = createFakeHttpClient()
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ body: validBadgeBody(), status: 200 });
			const sleep = createFakeSleep();
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const onRetry = vi.fn<NonNullable<OpenCloudHooks["onRetry"]>>();
			const onRateLimit = vi.fn<NonNullable<OpenCloudHooks["onRateLimit"]>>();
			const client = new BadgesClient({
				apiKey: "test-key",
				hooks: { onRateLimit, onRequest, onRetry },
				httpClient,
				sleep,
			});

			const result = await client.create({
				name: "First Goal",
				icon: ICON_BYTES,
				universeId: "999",
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(sleep.waits).toStrictEqual([1000]);
			expect(onRequest).toHaveBeenCalledTimes(2);
			expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, expect.any(Error));
			expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(1000);
		});

		it("should sleep on the rate-limit queue once the burst allowance is exhausted", async () => {
			expect.assertions(1);

			const httpClient = mockManyOk(createFakeHttpClient(), 2);
			const clock = createFakeClock();
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			for (let index = 0; index < 2; index++) {
				await client.create({
					name: "First Goal",
					icon: ICON_BYTES,
					universeId: "999",
				});
			}

			expect(clock.waits).toStrictEqual([200]);
		});
	});

	describe("update", () => {
		it("should PATCH with a JSON body and resolve to undefined data on 200", async () => {
			expect.assertions(5);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({
				name: "Renamed",
				badgeId: "12345",
				description: "Renamed.",
				enabled: false,
			});

			assert(result.success);

			expect(result.data).toBeUndefined();
			expect(httpClient.requests).toHaveLength(1);
			expect(httpClient.requests[0]?.request.method).toBe("PATCH");
			expect(httpClient.requests[0]?.request.body).toStrictEqual({
				name: "Renamed",
				description: "Renamed.",
				enabled: false,
			});
			expect(httpClient.requests[0]?.request.url).toBe("/legacy-badges/v1/badges/12345");
		});

		it("should propagate the http error when the PATCH fails", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 404 });
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({ badgeId: "12345" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).toHaveProperty("statusCode", 404);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should retry a 5xx PATCH because update is idempotent", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: {}, status: 200 });
			const sleep = createFakeSleep();
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.update({ badgeId: "12345", enabled: true });

			assert(result.success);

			expect(result.data).toBeUndefined();
			expect(httpClient.requests).toHaveLength(2);
			expect(sleep.waits).toStrictEqual([1000]);
		});

		it("should use a queue independent of create() on the same client", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient()
				.mockResponse({ body: validBadgeBody(), status: 200 })
				.mockResponse({ body: {}, status: 200 });
			const clock = createFakeClock();
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await client.create({ name: "First Goal", icon: ICON_BYTES, universeId: "999" });
			await client.update({ badgeId: "12345", enabled: false });

			expect(clock.waits).toStrictEqual([]);
		});
	});

	describe("uploadIcon", () => {
		it("should return success with no payload and POST a multipart body", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient().mockResponse({
				body: { targetId: 67_890 },
				status: 200,
			});
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.uploadIcon({ badgeId: "12345", icon: ICON_BYTES });

			assert(result.success);

			expect(result.data).toBeUndefined();
			expect(httpClient.requests[0]?.request.method).toBe("POST");
			expect(httpClient.requests[0]?.request.url).toBe(
				"/legacy-publish/v1/badges/12345/icon",
			);
			expect(httpClient.requests[0]?.request.body).toBeInstanceOf(FormData);
		});

		it("should not retry a 5xx so a duplicate icon upload can't be created", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: { targetId: 67_890 }, status: 200 });
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.uploadIcon({ badgeId: "12345", icon: ICON_BYTES });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should use a queue independent of create() and update()", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient()
				.mockResponse({ body: validBadgeBody(), status: 200 })
				.mockResponse({ body: {}, status: 200 })
				.mockResponse({ body: { targetId: 67_890 }, status: 200 });
			const clock = createFakeClock();
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await client.create({ name: "First Goal", icon: ICON_BYTES, universeId: "999" });
			await client.update({ badgeId: "12345", enabled: false });
			await client.uploadIcon({ badgeId: "12345", icon: ICON_BYTES });

			expect(clock.waits).toStrictEqual([]);
		});
	});

	describe("permission errors", () => {
		it("should surface a 403 on create as a PermissionError naming the spend-robux scope", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.create({
				name: "First Goal",
				icon: ICON_BYTES,
				universeId: "999",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.statusCode).toBe(403);
			expect(result.err.requiredScopes).toStrictEqual([
				"legacy-universe.badge:manage-and-spend-robux",
			]);
			expect(result.err.operationKey).toBe("badges.create");
		});

		it("should surface a 401 on update as a PermissionError naming legacy-universe.badge:write", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 401 });
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({ badgeId: "12345" });

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["legacy-universe.badge:write"]);
			expect(result.err.operationKey).toBe("badges.update");
		});

		it("should surface a 403 on uploadIcon as a PermissionError naming legacy-badge:manage", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new BadgesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.uploadIcon({ badgeId: "12345", icon: ICON_BYTES });

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["legacy-badge:manage"]);
			expect(result.err.operationKey).toBe("badges.upload-icon");
		});
	});
});
