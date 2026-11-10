import { assert, describe, it } from "vitest";

import { PlacesClient } from "#src/resources/places/index";
import { loadFixture } from "#tests/conformance/_helpers";
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

		const first = await client.list({ universeId: "47545" });
		assert(first.success);
		assert(first.data.nextPageToken !== undefined);

		expect(first.data.items).toHaveLength(10);

		const last = await client.list({
			pageSize: 10,
			pageToken: first.data.nextPageToken,
			universeId: "47545",
		});
		assert(last.success);

		expect(last.data.nextPageToken).toBeUndefined();
		expect(httpClient.requests.map((request) => request.request.url)).toStrictEqual([
			"/v1/universes/47545/places",
			"/v1/universes/47545/places?limit=10&cursor=110514925318787_1_2770f76f7061192b85bbbdbadaeac6f4",
		]);
		expect(httpClient.requests[0]!.config).toMatchObject({
			baseUrl: "https://develop.roblox.com",
			credential: { kind: "none" },
		});
		expect(httpClient.requests[1]!.config).toMatchObject({ credential: { kind: "none" } });
	});
});
