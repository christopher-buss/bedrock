import { describe, it, vi } from "vitest";

import { createFetchHttpClient } from "./fetch-http-client.ts";

const CONFIG = { apiKey: "key", baseUrl: "https://example.com" };

describe(createFetchHttpClient, () => {
	it("should send through the given fetch", async ({ expect }) => {
		expect.assertions(2);

		const urls: Array<string> = [];
		async function fakeFetchAsync(url: string): Promise<Response> {
			urls.push(url);
			return new Response(undefined, { status: 204 });
		}

		const client = createFetchHttpClient({ fetch: fakeFetchAsync });
		const result = await client.request({ method: "GET", url: "/test" }, CONFIG);

		expect(result.success).toBeTrue();
		expect(urls).toStrictEqual(["https://example.com/test"]);
	});

	it("should send through the global fetch when no options are given", async ({ expect }) => {
		expect.assertions(2);

		const urls: Array<string> = [];
		vi.stubGlobal("fetch", async (url: string): Promise<Response> => {
			urls.push(url);
			return new Response(undefined, { status: 204 });
		});

		const result = await createFetchHttpClient()
			.request({ method: "GET", url: "/test" }, CONFIG)
			.finally(() => vi.unstubAllGlobals());

		expect(result.success).toBeTrue();
		expect(urls).toStrictEqual(["https://example.com/test"]);
	});
});
