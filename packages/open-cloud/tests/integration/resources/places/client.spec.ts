import { assert, describe, expect, it, vi } from "vitest";

import type { OpenCloudHooks } from "#src/client/types";
import { PUBLISH_OPERATION_LIMIT } from "#src/domains/universes/places/operations";
import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { ValidationError } from "#src/errors/validation";
import { PlacesClient } from "#src/resources/places/client";
import { CodedError } from "#tests/helpers/coded-error";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import {
	rbxlBody,
	rbxlxBody,
	validPlaceBody,
	validPublishResponseBody,
} from "#tests/helpers/places";

const { burstCapacity: PUBLISH_BURST = 1, maxPerSecond: PUBLISH_PER_SECOND } =
	PUBLISH_OPERATION_LIMIT;
const PUBLISH_INTERVAL_MS = 1000 / PUBLISH_PER_SECOND;

async function spendPublishBurstAsync(client: PlacesClient): Promise<void> {
	for (let index = 0; index < PUBLISH_BURST; index++) {
		await client.publish({
			body: rbxlBody(),
			format: "rbxl",
			placeId: "1",
			universeId: "2",
		});
	}
}

describe(PlacesClient, () => {
	describe("publish", () => {
		it("should return a parsed PlaceVersion on a happy path", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validPublishResponseBody({ versionNumber: 7 }),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data).toStrictEqual({ versionNumber: 7 });
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should send a POST whose URL embeds the IDs and the Published query string", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validPublishResponseBody(),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "999",
				universeId: "111",
			});

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("POST");
			expect(captured.request.url).toBe(
				"/universes/v1/111/places/999/versions?versionType=Published",
			);
			expect(captured.request.headers).toStrictEqual({
				"content-type": "application/octet-stream",
			});
		});

		it("should send the rbxlx Content-Type when the format is rbxlx", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validPublishResponseBody(),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.publish({
				body: rbxlxBody(),
				format: "rbxlx",
				placeId: "456",
				universeId: "123",
			});

			expect(httpClient.requests[0]!.request.headers).toStrictEqual({
				"content-type": "application/xml",
			});
		});

		it("should short-circuit on an empty body without firing HTTP, sleep, or hooks", async () => {
			expect.assertions(5);

			const httpClient = createFakeHttpClient();
			const sleep = createFakeSleep();
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const client = new PlacesClient({
				apiKey: "test-key",
				hooks: { onRequest },
				httpClient,
				sleep,
			});

			const result = await client.publish({
				body: new Uint8Array(0),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err).toHaveProperty("code", "empty_body");
			expect(httpClient.requests).toHaveLength(0);
			expect(sleep.waits).toStrictEqual([]);
			expect(onRequest).not.toHaveBeenCalled();
		});

		it("should retry a 429, thread the retry-after wait through sleep, and fire all hooks", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient()
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ body: validPublishResponseBody(), status: 200 });
			const sleep = createFakeSleep();
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const onRetry = vi.fn<NonNullable<OpenCloudHooks["onRetry"]>>();
			const onRateLimit = vi.fn<NonNullable<OpenCloudHooks["onRateLimit"]>>();
			const client = new PlacesClient({
				apiKey: "test-key",
				hooks: { onRateLimit, onRequest, onRetry },
				httpClient,
				sleep,
			});

			const result = await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(onRequest).toHaveBeenCalledTimes(2);
			expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, expect.any(Error));
			expect(onRateLimit.mock.calls).toStrictEqual([[1000]]);
		});

		it("should not retry a 5xx so a transient publish failure does not duplicate the version", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: validPublishResponseBody(), status: 200 });
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).toHaveProperty("statusCode", 500);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should retry a gateway-rejected publish because it never reached Open Cloud", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(
					new ApiError("HTTP 400", {
						gatewaySummary: "400 Bad request",
						statusCode: 400,
					}),
				)
				.mockResponse({
					body: validPublishResponseBody({ versionNumber: 8 }),
					status: 200,
				});
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data).toStrictEqual({ versionNumber: 8 });
			expect(httpClient.requests).toHaveLength(2);
		});

		it("should retry a socket reset because the killed request created no version", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockNetworkError({ cause: new CodedError("read ECONNRESET", "ECONNRESET") })
				.mockResponse({
					body: validPublishResponseBody({ versionNumber: 9 }),
					status: 200,
				});
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data).toStrictEqual({ versionNumber: 9 });
			expect(httpClient.requests).toHaveLength(2);
		});

		it.for([400, 401, 403, 404, 409])(
			"should surface HTTP %s as an ApiError with the matching statusCode",
			async (statusCode) => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient({
					schemaValidation: "strict",
				}).mockApiError({ statusCode });
				const client = new PlacesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.publish({
					body: rbxlBody(),
					format: "rbxl",
					placeId: "456",
					universeId: "123",
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
				expect(result.err).toHaveProperty("statusCode", statusCode);
			},
		);

		it("should route a per-request apiKey override through the request config", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validPublishResponseBody(),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "default-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.publish(
				{
					body: rbxlBody(),
					format: "rbxl",
					placeId: "456",
					universeId: "123",
				},
				{ apiKey: "override-key" },
			);

			expect(httpClient.requests[0]!.config.apiKey).toBe("override-key");
		});
	});

	describe("save", () => {
		it("should target the Saved query string and return a parsed PlaceVersion", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validPublishResponseBody({ versionNumber: 12 }),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.save({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data).toStrictEqual({ versionNumber: 12 });
			expect(httpClient.requests[0]!.request.url).toEndWith("?versionType=Saved");
		});

		it("should short-circuit on a format mismatch without firing HTTP", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient();
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.save({
				body: rbxlxBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err).toHaveProperty("code", "format_mismatch");
			expect(httpClient.requests).toHaveLength(0);
		});

		it("should not retry a 5xx so a transient save failure does not duplicate the version", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({
				statusCode: 503,
			});
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.save({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(!result.success);

			expect(result.err).toHaveProperty("statusCode", 503);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should retry a gateway-rejected save because it never reached Open Cloud", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(
					new ApiError("HTTP 400", {
						gatewaySummary: "400 Bad request",
						statusCode: 400,
					}),
				)
				.mockResponse({
					body: validPublishResponseBody({ versionNumber: 4 }),
					status: 200,
				});
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.save({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data).toStrictEqual({ versionNumber: 4 });
			expect(httpClient.requests).toHaveLength(2);
		});
	});

	describe("update", () => {
		it("should send a PATCH with a derived updateMask and return the parsed Place", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validPlaceBody({ description: "Updated" }),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({
				description: "Updated",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("PATCH");
			expect(captured.request.url).toBe(
				"/cloud/v2/universes/123/places/456?updateMask=description",
			);
			expect(captured.request.body).toStrictEqual({ description: "Updated" });
			expect(result.data.description).toBe("Updated");
		});

		it("should short-circuit on an empty update with no HTTP traffic", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient();
			const sleep = createFakeSleep();
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.update({ placeId: "456", universeId: "123" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err).toHaveProperty("code", "empty_update");
			expect(httpClient.requests).toHaveLength(0);
			expect(sleep.waits).toStrictEqual([]);
		});

		it("should retry a 5xx since update is idempotent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 502 })
				.mockResponse({ body: validPlaceBody(), status: 200 });
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({
				description: "Retry test",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(result.data).toBeDefined();
		});

		it("should retry a 429, thread the retry-after wait through sleep, and fire all hooks", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient()
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ body: validPlaceBody(), status: 200 });
			const sleep = createFakeSleep();
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const onRetry = vi.fn<NonNullable<OpenCloudHooks["onRetry"]>>();
			const onRateLimit = vi.fn<NonNullable<OpenCloudHooks["onRateLimit"]>>();
			const client = new PlacesClient({
				apiKey: "test-key",
				hooks: { onRateLimit, onRequest, onRetry },
				httpClient,
				sleep,
			});

			const result = await client.update({
				description: "Retry test",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			// The 100/min update queue has room on the first call and refills
			// before the retry, so onRateLimit fires only for the retry-after
			// delay surfaced by the 429.
			expect(httpClient.requests).toHaveLength(2);
			expect(onRequest).toHaveBeenCalledTimes(2);
			expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, expect.any(Error));
			expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(1000);
		});

		it("should route a per-request apiKey override through the request config", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validPlaceBody(),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "default-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.update(
				{ description: "Override test", placeId: "456", universeId: "123" },
				{ apiKey: "override-key" },
			);

			expect(httpClient.requests[0]!.config.apiKey).toBe("override-key");
		});
	});

	describe("shared rate-limit bucket", () => {
		it("should make a save wait once publishes have spent the shared per-API-key burst", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient();
			for (let index = 0; index <= PUBLISH_BURST; index++) {
				httpClient.mockResponse({ body: validPublishResponseBody(), status: 200 });
			}

			const clock = createFakeClock();
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await spendPublishBurstAsync(client);
			await client.save({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "1",
				universeId: "2",
			});

			expect(httpClient.requests).toHaveLength(PUBLISH_BURST + 1);
			expect(clock.waits).toStrictEqual([PUBLISH_INTERVAL_MS]);
		});

		it("should let an apiKey override send without waiting once the default key's burst is spent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient();
			for (let index = 0; index < PUBLISH_BURST + 2; index++) {
				httpClient.mockResponse({ body: validPublishResponseBody(), status: 200 });
			}

			const clock = createFakeClock();
			const client = new PlacesClient({
				apiKey: "default-key",
				httpClient,
				sleep: clock.sleep,
			});

			await spendPublishBurstAsync(client);
			await client.publish(
				{
					body: rbxlBody(),
					format: "rbxl",
					placeId: "1",
					universeId: "2",
				},
				{ apiKey: "override-key" },
			);
			await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "1",
				universeId: "2",
			});

			const overrideCapture = httpClient.requests.at(-2);
			assert(overrideCapture !== undefined);

			expect(overrideCapture.config.apiKey).toBe("override-key");
			expect(clock.waits).toStrictEqual([PUBLISH_INTERVAL_MS]);
		});
	});

	describe("independent rate-limit buckets", () => {
		it("should let an update send without waiting once publish's burst is spent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient();
			for (let index = 0; index < PUBLISH_BURST; index++) {
				httpClient.mockResponse({ body: validPublishResponseBody(), status: 200 });
			}

			httpClient
				.mockResponse({ body: validPlaceBody(), status: 200 })
				.mockResponse({ body: validPublishResponseBody(), status: 200 });
			const clock = createFakeClock();
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await spendPublishBurstAsync(client);
			await client.update({
				description: "Isolation test",
				placeId: "1",
				universeId: "2",
			});
			await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "1",
				universeId: "2",
			});

			expect(httpClient.requests).toHaveLength(PUBLISH_BURST + 2);
			expect(clock.waits).toStrictEqual([PUBLISH_INTERVAL_MS]);
		});
	});

	describe("permission errors", () => {
		it("should surface a 403 on publish as a PermissionError naming universe-places:write", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["universe-places:write"]);
			expect(result.err.operationKey).toBe("places.publishVersion");
		});

		it("should surface a 401 on save as a PermissionError naming universe-places:write", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 401 });
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.save({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "456",
				universeId: "123",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["universe-places:write"]);
		});

		it("should surface a 403 on update as a PermissionError naming universe.place:write", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({
				description: "blocked",
				placeId: "456",
				universeId: "123",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["universe.place:write"]);
			expect(result.err.operationKey).toBe("places.update");
		});
	});
});
