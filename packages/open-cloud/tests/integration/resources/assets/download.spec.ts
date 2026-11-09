import { assert, describe, it } from "vitest";

import { ApiError } from "#src/errors/api-error";
import { NetworkError } from "#src/errors/network-error";
import { RateLimitError } from "#src/errors/rate-limit";
import { RequestAbortedError } from "#src/errors/request-aborted";
import { UnexpectedResponseError } from "#src/errors/unexpected-response";
import { AssetsClient } from "#src/resources/assets/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { gzipAsync } from "#tests/helpers/gzip";

const LOCATION = "https://cdn.example.test/v1/bytes/abc?__token__=signed";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

interface FetchCall {
	readonly init: RequestInit;
	readonly url: string;
}

function createClient(
	httpClient: ReturnType<typeof createFakeHttpClient>,
	respond: () => Promise<Response>,
): { calls: Array<FetchCall>; client: AssetsClient } {
	const calls: Array<FetchCall> = [];
	const client = new AssetsClient({
		credential: { apiKey: "key", kind: "apiKey" },
		fetch: async (url, init) => {
			calls.push({ init, url });
			return respond();
		},
		httpClient,
	});
	return { calls, client };
}

describe("assets download", () => {
	it("should gunzip raw gzip content the CDN serves without a content encoding", async ({
		expect,
	}) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { location: LOCATION },
			status: 200,
		});
		const gzipped = await gzipAsync(PNG);
		const { client } = createClient(httpClient, async () => new Response(gzipped));

		await expect(client.download({ assetId: "123" })).resolves.toStrictEqual({
			data: PNG,
			success: true,
		});
	});

	it("should return an unexpected response error when gzip content does not decode", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { location: LOCATION },
			status: 200,
		});
		const { client } = createClient(
			httpClient,
			async () => new Response(new Uint8Array([0x1f, 0x8b, 0, 0]), { status: 200 }),
		);

		const result = await client.download({ assetId: "123" });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toContain("Asset content is not valid gzip");
		expect(result.err).toMatchObject({
			method: "GET",
			statusCode: 200,
			url: "https://cdn.example.test/v1/bytes/abc",
		});
	});

	it("should follow the location and return the stored bytes without the credential", async ({
		expect,
	}) => {
		expect.assertions(4);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { location: LOCATION },
			status: 200,
		});
		const { calls, client } = createClient(httpClient, async () => new Response(PNG));

		const result = await client.download({ assetId: "123" });
		assert(result.success);

		expect(result.data).toStrictEqual(PNG);
		expect(httpClient.requests[0]!.request.url).toBe("/asset-delivery-api/v1/assetId/123");
		expect(calls.map((call) => call.url)).toStrictEqual([LOCATION]);

		const cdnHeaders = new Headers(calls[0]!.init.headers);

		expect(cdnHeaders.has("x-api-key")).toBe(false);
	});

	it("should forward the caller's signal to the CDN download", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { location: LOCATION },
			status: 200,
		});
		const { calls, client } = createClient(httpClient, async () => new Response(PNG));
		const controller = new AbortController();

		await client.download({ assetId: "123" }, { signal: controller.signal });

		expect(calls[0]!.init.signal).toBe(controller.signal);
	});

	it.for([300, 403])(
		"should return an api error without the signed token when the CDN answers %i",
		async (status, { expect }) => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: { location: LOCATION },
				status: 200,
			});
			const { client } = createClient(
				httpClient,
				async () => new Response("denied", { status }),
			);

			const result = await client.download({ assetId: "123" });
			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err.message).toBe(`Asset content download failed with HTTP ${status}`);
			expect(result.err).toMatchObject({
				method: "GET",
				statusCode: status,
				url: "https://cdn.example.test/v1/bytes/abc",
			});
			expect(JSON.stringify(result.err)).not.toContain("signed");
		},
	);

	it("should return a network error when the CDN cannot be reached", async ({ expect }) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { location: LOCATION },
			status: 200,
		});
		const cause = new TypeError("fetch failed");
		const { client } = createClient(httpClient, async () => {
			throw cause;
		});

		const result = await client.download({ assetId: "123" });
		assert(!result.success);
		assert(result.err instanceof NetworkError);

		expect(result.err.message).toBe("Network request failed");
		expect(result.err.cause).toBe(cause);
		expect(result.err).toMatchObject({
			method: "GET",
			url: "https://cdn.example.test/v1/bytes/abc",
		});
	});

	it("should return a request aborted error when the caller aborts the CDN download", async ({
		expect,
	}) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { location: LOCATION },
			status: 200,
		});
		const controller = new AbortController();
		const { client } = createClient(httpClient, async () => {
			controller.abort();
			throw new DOMException("aborted", "AbortError");
		});

		const result = await client.download({ assetId: "123" }, { signal: controller.signal });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(RequestAbortedError);
	});

	it("should return a rate limit error with the retry-after wait when the CDN answers 429", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { location: LOCATION },
			status: 200,
		});
		const { client } = createClient(
			httpClient,
			async () => new Response("slow", { headers: { "retry-after": "7" }, status: 429 }),
		);

		const result = await client.download({ assetId: "123" });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(RateLimitError);
		expect(result.err).toMatchObject({ retryAfterSeconds: 7, statusCode: 429 });
	});

	it("should return an unexpected response error when the location is not a url", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { location: "not a url" },
			status: 200,
		});
		const { calls, client } = createClient(httpClient, async () => new Response(PNG));

		const result = await client.download({ assetId: "123" });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(calls).toHaveLength(0);
	});

	it("should return the location error without contacting the CDN", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { errors: [{ code: 404, message: "Request asset was not found" }] },
			status: 200,
		});
		const { calls, client } = createClient(httpClient, async () => new Response(PNG));

		const result = await client.download({ assetId: "123" });

		expect(result).toMatchObject({ err: { statusCode: 404 }, success: false });
		expect(calls).toHaveLength(0);
	});
});
