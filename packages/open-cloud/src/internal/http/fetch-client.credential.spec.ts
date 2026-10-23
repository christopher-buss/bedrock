import { describe, it } from "vitest";

import { buildFetchOptions } from "./fetch-client.ts";

const OAUTH_CONFIG = {
	baseUrl: "https://example.com",
	credential: { accessToken: "access-token", kind: "oauth" },
} as const;

describe(buildFetchOptions, () => {
	it("should send an OAuth access token as a Bearer authorization header", ({ expect }) => {
		expect.assertions(2);

		const options = buildFetchOptions({ method: "GET", url: "/test" }, OAUTH_CONFIG);
		const headers = new Headers(options.headers);

		expect(headers.get("authorization")).toBe("Bearer access-token");
		expect(headers.has("x-api-key")).toBe(false);
	});

	it("should not let request headers replace the OAuth authorization header", ({ expect }) => {
		expect.assertions(2);

		const options = buildFetchOptions(
			{
				headers: { "Authorization": "Bearer stray", "X-Api-Key": "stray-key" },
				method: "GET",
				url: "/test",
			},
			OAUTH_CONFIG,
		);
		const headers = new Headers(options.headers);

		expect(headers.get("authorization")).toBe("Bearer access-token");
		expect(headers.has("x-api-key")).toBe(false);
	});

	it("should not let a request authorization header ride along with an API key", ({ expect }) => {
		expect.assertions(2);

		const options = buildFetchOptions(
			{ headers: { authorization: "Bearer stray" }, method: "GET", url: "/test" },
			{
				baseUrl: "https://example.com",
				credential: { apiKey: "key", kind: "apiKey" },
			},
		);
		const headers = new Headers(options.headers);

		expect(headers.has("authorization")).toBe(false);
		expect(headers.get("x-api-key")).toBe("key");
	});
});
