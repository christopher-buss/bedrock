import type { OpenCloudHooks } from "#src/client/types";
import { ApiError } from "#src/errors/api-error";
import { ValidationError } from "#src/errors/validation";
import { UniversesClient } from "#src/resources/universes/client";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validUniverseBody } from "#tests/helpers/universes";
import { assert, describe, expect, it, vi } from "vitest";

describe(UniversesClient, () => {
	describe("get", () => {
		it("should return a parsed Universe on a happy path", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: validUniverseBody({ path: "universes/42" }),
				status: 200,
			});
			const client = new UniversesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ universeId: "42" });

			assert(result.success);

			expect(result.data.id).toBe("42");
			expect(result.data.displayName).toBe("Test Universe");
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should send a GET whose URL embeds the universeId", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: validUniverseBody({ path: "universes/111" }),
				status: 200,
			});
			const client = new UniversesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.get({ universeId: "111" });

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("GET");
			expect(captured.request.url).toBe("/cloud/v2/universes/111");
		});

		it("should retry a 429 then succeed, firing onRetry and onRateLimit hooks", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" })
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ body: validUniverseBody(), status: 200 });
			const sleep = createFakeSleep();
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const onRetry = vi.fn<NonNullable<OpenCloudHooks["onRetry"]>>();
			const onRateLimit = vi.fn<NonNullable<OpenCloudHooks["onRateLimit"]>>();
			const client = new UniversesClient({
				apiKey: "test-key",
				hooks: { onRateLimit, onRequest, onRetry },
				httpClient,
				sleep,
			});

			const result = await client.get({ universeId: "123" });

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(onRequest).toHaveBeenCalledTimes(2);
			expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, expect.any(Error));
			expect(onRateLimit).toHaveBeenCalledWith(1000);
		});

		it("should retry a 5xx since get is idempotent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" })
				.mockApiError({ statusCode: 503 })
				.mockResponse({ body: validUniverseBody(), status: 200 });
			const client = new UniversesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ universeId: "123" });

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(result.data.id).toBe("12345");
		});

		it.for([400, 401, 403, 404])(
			"should surface HTTP %s as an ApiError with the matching statusCode",
			async (statusCode) => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient({
					schemaValidation: "strict",
				}).mockApiError({ statusCode });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.get({ universeId: "123" });

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
				expect(result.err).toHaveProperty("statusCode", statusCode);
			},
		);

		it("should route a per-request apiKey override through the request config", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: validUniverseBody(),
				status: 200,
			});
			const client = new UniversesClient({
				apiKey: "default-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.get({ universeId: "123" }, { apiKey: "override-key" });

			expect(httpClient.requests[0]?.config.apiKey).toBe("override-key");
		});
	});

	describe("update", () => {
		it("should send a PATCH with a derived updateMask and return the parsed Universe", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: validUniverseBody({ voiceChatEnabled: true }),
				status: 200,
			});
			const client = new UniversesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({
				universeId: "12345",
				voiceChatEnabled: true,
			});

			assert(result.success);

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("PATCH");
			expect(captured.request.url).toBe(
				"/cloud/v2/universes/12345?updateMask=voiceChatEnabled",
			);
			expect(captured.request.body).toStrictEqual({ voiceChatEnabled: true });
			expect(result.data.voiceChatEnabled).toBeTrue();
		});

		it("should short-circuit on an empty update with no HTTP traffic", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" });
			const sleep = createFakeSleep();
			const client = new UniversesClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.update({ universeId: "12345" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err).toHaveProperty("code", "empty_update");
			expect(httpClient.requests).toHaveLength(0);
			expect(sleep.waits).toStrictEqual([]);
		});

		it("should retry a 5xx since update is idempotent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" })
				.mockApiError({ statusCode: 502 })
				.mockResponse({ body: validUniverseBody(), status: 200 });
			const client = new UniversesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({
				universeId: "12345",
				voiceChatEnabled: true,
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(result.data).toBeDefined();
		});

		it("should route a per-request apiKey override through the request config", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: validUniverseBody(),
				status: 200,
			});
			const client = new UniversesClient({
				apiKey: "default-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.update(
				{ universeId: "12345", voiceChatEnabled: true },
				{ apiKey: "override-key" },
			);

			expect(httpClient.requests[0]?.config.apiKey).toBe("override-key");
		});
	});

	describe("independent rate-limit buckets", () => {
		it("should account get and update against separate queues", async () => {
			expect.assertions(2);

			// Two calls on one 100/min queue drain into a single wait; if
			// get and update shared a queue, four sequential calls (two
			// gets + two updates) would trigger three waits. Independent
			// queues each pay only the second-call wait once, yielding a
			// total of two.
			const httpClient = createFakeHttpClient({ schemaValidation: "strict" })
				.mockResponse({ body: validUniverseBody(), status: 200 })
				.mockResponse({ body: validUniverseBody(), status: 200 })
				.mockResponse({ body: validUniverseBody(), status: 200 })
				.mockResponse({ body: validUniverseBody(), status: 200 });
			const clock = createFakeClock();
			const client = new UniversesClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await client.get({ universeId: "12345" });
			await client.get({ universeId: "12345" });
			await client.update({ universeId: "12345", voiceChatEnabled: true });
			await client.update({ universeId: "12345", voiceChatEnabled: false });

			expect(httpClient.requests).toHaveLength(4);
			expect(clock.waits).toHaveLength(2);
		});
	});
});
