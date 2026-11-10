import { assert, describe, it } from "vitest";

import { BadgesClient } from "#src/resources/badges/index";
import { validBadgeDetailsBody } from "#tests/helpers/badges";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

function createClient(httpClient: ReturnType<typeof createFakeHttpClient>): BadgesClient {
	return new BadgesClient({
		credential: { apiKey: "key", kind: "apiKey" },
		httpClient,
		sleep: createFakeSleep(),
	});
}

describe("badges list", () => {
	it("should list badges from badges.roblox.com with no credential", async ({ expect }) => {
		expect.assertions(4);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { data: [validBadgeDetailsBody()], nextPageCursor: "next +/=" },
			status: 200,
		});

		const result = await createClient(httpClient).list({ pageSize: 25, universeId: "999" });
		assert(result.success);

		expect(result.data.items.map((badge) => badge.id)).toStrictEqual(["12345"]);
		expect(result.data.nextPageToken).toBe("next +/=");
		expect(httpClient.requests[0]!.request).toStrictEqual({
			method: "GET",
			url: "/v1/universes/999/badges?limit=25",
		});
		expect(httpClient.requests[0]!.config).toMatchObject({
			baseUrl: "https://badges.roblox.com",
			credential: { kind: "none" },
		});
	});

	it("should forward the page token as the cursor", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient().mockResponse({ body: { data: [] }, status: 200 });

		const result = await createClient(httpClient).list({
			pageToken: "next +/=",
			universeId: "999",
		});
		assert(result.success);

		expect(result.data).toStrictEqual({ items: [], nextPageToken: undefined });
		expect(httpClient.requests[0]!.request.url).toBe(
			"/v1/universes/999/badges?cursor=next+%2B%2F%3D",
		);
	});
});
