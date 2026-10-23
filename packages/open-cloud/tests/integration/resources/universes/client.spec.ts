import { assert, describe, it, vi } from "vitest";

import type { OpenCloudHooks } from "#src/client/types";
import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { ValidationError } from "#src/errors/validation";
import { UniversesClient } from "#src/resources/universes/client";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validUniverseBody } from "#tests/helpers/universes";

describe(UniversesClient, () => {
	describe("get", () => {
		it("should return a parsed Universe on a happy path", async ({ expect }) => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validUniverseBody({ path: "universes/42" }),
				status: 200,
			});
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ universeId: "42" });

			assert(result.success);

			expect(result.data.id).toBe("42");
			expect(result.data.displayName).toBe("Test Universe");
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should send a GET whose URL embeds the universeId", async ({ expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validUniverseBody({ path: "universes/111" }),
				status: 200,
			});
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.get({ universeId: "111" });

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("GET");
			expect(captured.request.url).toBe("/cloud/v2/universes/111");
		});

		it("should retry a 429 then succeed, firing onRetry and onRateLimit hooks", async ({
			expect,
		}) => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient()
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ body: validUniverseBody(), status: 200 });
			const sleep = createFakeSleep();
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const onRetry = vi.fn<NonNullable<OpenCloudHooks["onRetry"]>>();
			const onRateLimit = vi.fn<NonNullable<OpenCloudHooks["onRateLimit"]>>();
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
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

		it("should retry a 5xx since get is idempotent", async ({ expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 503 })
				.mockResponse({ body: validUniverseBody(), status: 200 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
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
			async (statusCode, { expect }) => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockApiError({ statusCode });
				const client = new UniversesClient({
					credential: { apiKey: "test-key", kind: "apiKey" },
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.get({ universeId: "123" });

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
				expect(result.err).toHaveProperty("statusCode", statusCode);
			},
		);

		it("should route a per-request credential override through the request config", async ({
			expect,
		}) => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validUniverseBody(),
				status: 200,
			});
			const client = new UniversesClient({
				credential: { apiKey: "default-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.get(
				{ universeId: "123" },
				{ credential: { apiKey: "override-key", kind: "apiKey" } },
			);

			expect(httpClient.requests[0]!.config.credential).toStrictEqual({
				apiKey: "override-key",
				kind: "apiKey",
			});
		});
	});

	describe("update", () => {
		it("should send a PATCH with a derived updateMask and return the parsed Universe", async ({
			expect,
		}) => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validUniverseBody({ voiceChatEnabled: true }),
				status: 200,
			});
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
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

		it("should short-circuit on an empty update with no HTTP traffic", async ({ expect }) => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient();
			const sleep = createFakeSleep();
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
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

		it("should retry a 5xx since update is idempotent", async ({ expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 502 })
				.mockResponse({ body: validUniverseBody(), status: 200 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
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

		it("should route a per-request credential override through the request config", async ({
			expect,
		}) => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validUniverseBody(),
				status: 200,
			});
			const client = new UniversesClient({
				credential: { apiKey: "default-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.update(
				{ universeId: "12345", voiceChatEnabled: true },
				{ credential: { apiKey: "override-key", kind: "apiKey" } },
			);

			expect(httpClient.requests[0]!.config.credential).toStrictEqual({
				apiKey: "override-key",
				kind: "apiKey",
			});
		});
	});

	describe("independent rate-limit buckets", () => {
		it("should account get and update against separate queues", async ({ expect }) => {
			expect.assertions(2);

			// Two calls on one 100/min queue drain into a single wait; if
			// get and update shared a queue, four sequential calls (two
			// gets + two updates) would trigger three waits. Independent
			// queues each pay only the second-call wait once, yielding a
			// total of two.
			const httpClient = createFakeHttpClient()
				.mockResponse({ body: validUniverseBody(), status: 200 })
				.mockResponse({ body: validUniverseBody(), status: 200 })
				.mockResponse({ body: validUniverseBody(), status: 200 })
				.mockResponse({ body: validUniverseBody(), status: 200 });
			const clock = createFakeClock();
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
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

	describe("permission errors", () => {
		it("should leave a 403 on get as a generic ApiError when no scope is documented", async ({
			expect,
		}) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ universeId: "42" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).not.toBeInstanceOf(PermissionError);
		});

		it("should surface a 403 on update as a PermissionError naming universe:write", async ({
			expect,
		}) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.update({ universeId: "42", voiceChatEnabled: true });

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["universe:write"]);
			expect(result.err.operationKey).toBe("universes.update");
		});
	});
});
