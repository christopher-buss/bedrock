import { assert, describe, it } from "vitest";

import { AssetsClient } from "#src/resources/assets/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";

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
});
