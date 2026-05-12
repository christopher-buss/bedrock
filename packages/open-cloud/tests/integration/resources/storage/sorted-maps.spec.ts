import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { StorageClient } from "#src/resources/storage/client";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validSortedMapItemBody } from "#tests/helpers/memory-store-sorted-maps";
import { assert, describe, expect, it } from "vitest";

describe(StorageClient, () => {
	describe("sortedMaps.create", () => {
		it("should return a parsed SortedMapItem on a happy path", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validSortedMapItemBody({
					path: "cloud/v2/universes/123/memory-store/sorted-maps/my-map/items/abc",
				}),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.create({
				itemId: "abc",
				mapId: "my-map",
				universeId: "123",
				value: "hello",
			});

			assert(result.success);

			expect(result.data).toMatchObject({
				id: "abc",
				mapId: "my-map",
				universeId: "123",
			});
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should send a POST whose URL and JSON body carry the parameters", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validSortedMapItemBody(),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.sortedMaps.create({
				itemId: "abc123",
				mapId: "test-map",
				sortKey: { kind: "numeric", value: 100 },
				ttl: 30,
				universeId: "123",
				value: { foo: 1 },
			});

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("POST");
			expect(captured.request.url).toBe(
				"/cloud/v2/universes/123/memory-store/sorted-maps/test-map/items?id=abc123",
			);
			expect(captured.request.body).toStrictEqual({
				numericSortKey: 100,
				ttl: "30s",
				value: { foo: 1 },
			});
		});

		it("should not retry a 5xx so a transient create does not duplicate the item", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 503 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.create({
				itemId: "i",
				mapId: "m",
				universeId: "1",
				value: "x",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should upgrade a 403 to a PermissionError carrying memory-store.sorted-map:write", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.create({
				itemId: "i",
				mapId: "m",
				universeId: "1",
				value: "x",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["memory-store.sorted-map:write"]);
			expect(result.err.operationKey).toBe("memory-store-sorted-maps.create");
			expect(result.err.statusCode).toBe(403);
		});

		it("should route a per-request apiKey override through the request config", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validSortedMapItemBody(),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "default-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.sortedMaps.create(
				{
					itemId: "i",
					mapId: "m",
					universeId: "1",
					value: "x",
				},
				{ apiKey: "override-key" },
			);

			expect(httpClient.requests[0]?.config.apiKey).toBe("override-key");
		});
	});

	describe("sortedMaps.delete", () => {
		it("should send a DELETE whose URL embeds the path identifiers and return undefined on success", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: undefined,
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.delete({
				itemId: "abc123",
				mapId: "test-map",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data).toBeUndefined();

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("DELETE");
			expect(captured.request.url).toBe(
				"/cloud/v2/universes/123/memory-store/sorted-maps/test-map/items/abc123",
			);
		});

		it("should retry a 5xx since delete is idempotent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 502 })
				.mockResponse({ body: undefined, status: 200 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.delete({
				itemId: "i",
				mapId: "m",
				universeId: "1",
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(result.data).toBeUndefined();
		});

		it("should upgrade a 403 to a PermissionError carrying memory-store.sorted-map:write", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.delete({
				itemId: "i",
				mapId: "m",
				universeId: "1",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["memory-store.sorted-map:write"]);
			expect(result.err.operationKey).toBe("memory-store-sorted-maps.delete");
			expect(result.err.statusCode).toBe(403);
		});
	});

	describe("sortedMaps.update", () => {
		it("should return a parsed SortedMapItem on a happy path", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validSortedMapItemBody({
					path: "cloud/v2/universes/123/memory-store/sorted-maps/my-map/items/abc",
				}),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.update({
				itemId: "abc",
				mapId: "my-map",
				universeId: "123",
				value: "updated",
			});

			assert(result.success);

			expect(result.data).toMatchObject({ id: "abc", mapId: "my-map", universeId: "123" });
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should send a PATCH whose URL embeds allowMissing and whose body carries the partial update", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validSortedMapItemBody(),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.sortedMaps.update({
				allowMissing: true,
				itemId: "abc123",
				mapId: "test-map",
				sortKey: { kind: "string", value: "beta" },
				ttl: 60,
				universeId: "123",
			});

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("PATCH");
			expect(captured.request.url).toBe(
				"/cloud/v2/universes/123/memory-store/sorted-maps/test-map/items/abc123?allowMissing=true",
			);
			expect(captured.request.body).toStrictEqual({
				stringSortKey: "beta",
				ttl: "60s",
			});
		});

		it("should retry a 5xx since update is idempotent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 502 })
				.mockResponse({ body: validSortedMapItemBody(), status: 200 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.update({
				itemId: "i",
				mapId: "m",
				universeId: "1",
				value: "x",
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(result.data.id).toBe("abc123");
		});

		it("should upgrade a 403 to a PermissionError carrying memory-store.sorted-map:write", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.update({
				itemId: "i",
				mapId: "m",
				universeId: "1",
				value: "x",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["memory-store.sorted-map:write"]);
			expect(result.err.operationKey).toBe("memory-store-sorted-maps.update");
			expect(result.err.statusCode).toBe(403);
		});
	});

	describe("sortedMaps.get", () => {
		it("should return a parsed SortedMapItem on a happy path", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validSortedMapItemBody({
					path: "cloud/v2/universes/123/memory-store/sorted-maps/my-map/items/abc",
				}),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.get({
				itemId: "abc",
				mapId: "my-map",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data).toMatchObject({ id: "abc", mapId: "my-map", universeId: "123" });
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should send a GET whose URL embeds the path identifiers", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validSortedMapItemBody(),
				status: 200,
			});
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.sortedMaps.get({
				itemId: "abc123",
				mapId: "test-map",
				universeId: "123",
			});

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("GET");
			expect(captured.request.url).toBe(
				"/cloud/v2/universes/123/memory-store/sorted-maps/test-map/items/abc123",
			);
		});

		it("should retry a 5xx since get is idempotent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 502 })
				.mockResponse({ body: validSortedMapItemBody(), status: 200 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.get({
				itemId: "i",
				mapId: "m",
				universeId: "1",
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(result.data.id).toBe("abc123");
		});

		it("should upgrade a 403 to a PermissionError carrying memory-store.sorted-map:read", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new StorageClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.sortedMaps.get({
				itemId: "i",
				mapId: "m",
				universeId: "1",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual(["memory-store.sorted-map:read"]);
			expect(result.err.operationKey).toBe("memory-store-sorted-maps.get");
			expect(result.err.statusCode).toBe(403);
		});
	});
});
