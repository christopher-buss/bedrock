import type { OpenCloudHooks } from "#src/client/types";
import { ApiError } from "#src/errors/api-error";
import { ValidationError } from "#src/errors/validation";
import { PlacesClient } from "#src/resources/places/client";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { rbxlBody, rbxlxBody, validPublishResponseBody } from "#tests/helpers/places";
import { assert, describe, expect, it, vi } from "vitest";

describe(PlacesClient, () => {
	describe("publish", () => {
		it("should return a parsed PlaceVersion on a happy path", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
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

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
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

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
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

			expect(httpClient.requests[0]?.request.headers).toStrictEqual({
				"content-type": "application/xml",
			});
		});

		it("should short-circuit on an empty body without firing HTTP, sleep, or hooks", async () => {
			expect.assertions(5);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" });
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

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" })
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

			// Two HTTP attempts (429 then 200); onRequest fires per attempt.
			// onRetry fires once before the retry-after sleep. onRateLimit
			// fires once for the queue's pre-call token wait (the 0.5/sec
			// limit forces a wait on every call) and once more for the
			// retry-after delay surfaced by the 429.
			expect(httpClient.requests).toHaveLength(2);
			expect(onRequest).toHaveBeenCalledTimes(2);
			expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, expect.any(Error));
			expect(onRateLimit.mock.calls).toStrictEqual([[1000], [1000]]);
		});

		it("should not retry a 5xx so a transient publish failure does not duplicate the version", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" })
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

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
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

			expect(httpClient.requests[0]?.config.apiKey).toBe("override-key");
		});
	});

	describe("save", () => {
		it("should target the Saved query string and return a parsed PlaceVersion", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
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
			expect(httpClient.requests[0]?.request.url).toEndWith("?versionType=Saved");
		});

		it("should short-circuit on a format mismatch without firing HTTP", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" });
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

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockApiError({
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
	});

	describe("shared rate-limit bucket", () => {
		it("should serialize publish and save through the same per-API-key queue", async () => {
			expect.assertions(2);

			// Against a single 0.5/sec queue, the first call pays a 1000ms
			// init wait and leaves the bucket maxed out. The second call
			// (the save) inherits that fully-drained bucket and pays a
			// 2000ms wait — exposing the shared accounting. Two
			// independent queues would each pay only their own 1000ms
			// init and the second wait would be 1000ms.
			const httpClient = createFakeHttpClient({ schemaValidation: "strict" })
				.mockResponse({ body: validPublishResponseBody(), status: 200 })
				.mockResponse({ body: validPublishResponseBody(), status: 200 });
			const clock = createFakeClock();
			const client = new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "1",
				universeId: "2",
			});
			await client.save({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "1",
				universeId: "2",
			});

			expect(httpClient.requests).toHaveLength(2);
			expect(clock.waits).toStrictEqual([1000, 2000]);
		});

		it("should route a per-request apiKey override into a queue independent of the default key", async () => {
			expect.assertions(2);

			// First call drains the default-key queue (forces a 1000ms
			// wait). The second call uses an apiKey override; if the
			// override correctly routes to a fresh queue it pays only the
			// queue-init wait (1000ms again), not a wait coordinated with
			// the default-key queue.
			const httpClient = createFakeHttpClient({ schemaValidation: "strict" })
				.mockResponse({ body: validPublishResponseBody(), status: 200 })
				.mockResponse({ body: validPublishResponseBody(), status: 200 });
			const clock = createFakeClock();
			const client = new PlacesClient({
				apiKey: "default-key",
				httpClient,
				sleep: clock.sleep,
			});

			await client.publish({
				body: rbxlBody(),
				format: "rbxl",
				placeId: "1",
				universeId: "2",
			});
			await client.publish(
				{
					body: rbxlBody(),
					format: "rbxl",
					placeId: "1",
					universeId: "2",
				},
				{ apiKey: "override-key" },
			);

			expect(httpClient.requests.map((capture) => capture.config.apiKey)).toStrictEqual([
				"default-key",
				"override-key",
			]);
			expect(clock.waits).toStrictEqual([1000, 1000]);
		});
	});
});
