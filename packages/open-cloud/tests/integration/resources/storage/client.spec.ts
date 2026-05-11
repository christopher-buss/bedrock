import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { StorageClient } from "#src/resources/storage/client";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validDequeueBody, validQueueItemBody } from "#tests/helpers/memory-store-queues";
import { assert, describe, expect, it } from "vitest";

describe(StorageClient, () => {
	describe("queues.enqueue", () => {
		it("should return a parsed QueueItem on a happy path", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validQueueItemBody({
					path: "cloud/v2/universes/123/memory-store/queues/my-queue/items/abc",
				}),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.queues.enqueue({
				data: "hello",
				queueId: "my-queue",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data).toMatchObject({
				id: "abc",
				queueId: "my-queue",
				universeId: "123",
			});
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should send a POST whose URL and JSON body carry the parameters", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validQueueItemBody(),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.queues.enqueue({
				data: { foo: 1 },
				priority: 5,
				queueId: "test-queue",
				ttl: 30,
				universeId: "123",
			});

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("POST");
			expect(captured.request.url).toBe(
				"/cloud/v2/universes/123/memory-store/queues/test-queue/items",
			);
			expect(captured.request.body).toStrictEqual({
				data: { foo: 1 },
				priority: 5,
				ttl: "30s",
			});
		});

		it("should not retry a 5xx so a transient enqueue failure does not duplicate the item", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 503 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.queues.enqueue({
				data: "hello",
				queueId: "q",
				universeId: "1",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should upgrade a 403 to a PermissionError carrying the required scopes", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.queues.enqueue({
				data: "hello",
				queueId: "q",
				universeId: "1",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["memory-store.queue:add"]);
			expect(result.err.operationKey).toBe("memory-store-queues.enqueue");
			expect(result.err.statusCode).toBe(403);
		});

		it("should route a per-request apiKey override through the request config", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validQueueItemBody(),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "default-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.queues.enqueue(
				{ data: "x", queueId: "q", universeId: "1" },
				{ apiKey: "override-key" },
			);

			expect(httpClient.requests[0]?.config.apiKey).toBe("override-key");
		});
	});

	describe("queues.dequeue", () => {
		it("should return a parsed DequeueResult on a happy path", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validDequeueBody({ id: "read-1" }),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.queues.dequeue({
				count: 1,
				queueId: "test-queue",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.readId).toBe("read-1");
			expect(result.data.items).toHaveLength(1);
		});

		it("should send a GET targeting the :read custom method with query params", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validDequeueBody(),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.queues.dequeue({
				count: 5,
				invisibilityWindow: 30,
				queueId: "test-queue",
				universeId: "123",
			});

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("GET");
			expect(captured.request.url).toBe(
				"/cloud/v2/universes/123/memory-store/queues/test-queue/items:read?count=5&invisibilityWindow=30s",
			);
		});

		it("should not retry a 5xx so a transient dequeue does not lose a batch", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 503 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.queues.dequeue({ queueId: "q", universeId: "1" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should upgrade a 403 to a PermissionError carrying memory-store.queue:dequeue", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.queues.dequeue({ queueId: "q", universeId: "1" });

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["memory-store.queue:dequeue"]);
			expect(result.err.operationKey).toBe("memory-store-queues.dequeue");
			expect(result.err.statusCode).toBe(403);
		});
	});

	describe("queues.discard", () => {
		it("should send a POST whose body carries the readId, returning undefined on success", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient().mockResponse({
				body: undefined,
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.queues.discard({
				queueId: "test-queue",
				readId: "read-1",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data).toBeUndefined();

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("POST");
			expect(captured.request.url).toBe(
				"/cloud/v2/universes/123/memory-store/queues/test-queue/items:discard",
			);
			expect(captured.request.body).toStrictEqual({ readId: "read-1" });
		});

		it("should retry a 5xx since discard is idempotent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 502 })
				.mockResponse({ body: undefined, status: 200 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.queues.discard({
				queueId: "q",
				readId: "abc",
				universeId: "1",
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(result.data).toBeUndefined();
		});

		it("should upgrade a 403 to a PermissionError carrying memory-store.queue:discard", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.queues.discard({
				queueId: "q",
				readId: "abc",
				universeId: "1",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["memory-store.queue:discard"]);
			expect(result.err.operationKey).toBe("memory-store-queues.discard");
			expect(result.err.statusCode).toBe(403);
		});
	});
});
