import { assert, describe, it } from "vitest";

import { RateLimitError } from "#src/errors/rate-limit";
import { PlacesClient } from "#src/resources/places/index";
import { loadFixture } from "#tests/conformance/_helpers";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

describe("places list", () => {
	it("should list places from develop.roblox.com with no credential and forward the cursor", async ({
		expect,
	}) => {
		expect.assertions(5);

		const httpClient = createFakeHttpClient()
			.mockResponse({
				body: loadFixture("places", "list-response-first-page.json"),
				status: 200,
			})
			.mockResponse({
				body: loadFixture("places", "list-response-last-page.json"),
				status: 200,
			});
		const client = new PlacesClient({
			credential: { apiKey: "key", kind: "apiKey" },
			httpClient,
			sleep: createFakeSleep(),
		});

		const first = await client.list({ universeId: "123" });
		assert(first.success);
		assert(first.data.nextPageToken !== undefined);

		expect(first.data.items).toHaveLength(10);

		const last = await client.list({
			pageSize: 10,
			pageToken: first.data.nextPageToken,
			universeId: "123",
		});
		assert(last.success);

		expect(last.data.nextPageToken).toBeUndefined();
		expect(httpClient.requests.map((request) => request.request.url)).toStrictEqual([
			"/v1/universes/123/places",
			"/v1/universes/123/places?limit=10&cursor=45600000000003_1_0123456789abcdef0123456789abcdef",
		]);
		expect(httpClient.requests[0]!.config).toMatchObject({
			baseUrl: "https://develop.roblox.com",
			credential: { kind: "none" },
		});
		expect(httpClient.requests[1]!.config).toMatchObject({ credential: { kind: "none" } });
	});

	it("should wait out a 429 until x-ratelimit-reset, not retry-after, then list", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient()
			.mockError(
				new RateLimitError("Rate limited", {
					details: { errors: [{ code: 0, message: "" }] },
					responseHeaders: { "retry-after": "5", "x-ratelimit-reset": "22" },
					retryAfterSeconds: 5,
					source: "edge",
					statusCode: 429,
				}),
			)
			.mockResponse({
				body: loadFixture("places", "list-response-last-page.json"),
				status: 200,
			});
		const clock = createFakeClock();
		const client = new PlacesClient({
			credential: { apiKey: "key", kind: "apiKey" },
			httpClient,
			sleep: clock.sleep,
		});

		const result = await client.list({ universeId: "123" });

		expect(result.success).toBe(true);
		expect(clock.waits).toStrictEqual([22_000]);
	});
});
