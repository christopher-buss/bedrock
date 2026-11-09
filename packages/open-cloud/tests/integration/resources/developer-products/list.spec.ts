import { assert, describe, it } from "vitest";

import { DeveloperProductsClient } from "#src/resources/developer-products/index";
import { validDeveloperProductBody } from "#tests/helpers/developer-products";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";

describe("developer products list", () => {
	it("should list products and forward the next cursor", async ({ expect }) => {
		expect.assertions(4);

		const httpClient = createFakeHttpClient()
			.mockResponse({
				body: {
					developerProducts: [validDeveloperProductBody()],
					nextPageToken: "next +/=",
				},
				status: 200,
			})
			.mockResponse({
				body: { developerProducts: [], nextPageToken: JSON.parse("null") },
				status: 200,
			});
		const client = new DeveloperProductsClient({
			credential: { apiKey: "key", kind: "apiKey" },
			httpClient,
		});
		const first = await client.list({ universeId: "999" });
		assert(first.success);
		assert(first.data.nextPageToken !== undefined);

		expect(first.data.items[0]!.id).toBe("12345");
		expect(first.data.nextPageToken).toBe("next +/=");

		const last = await client.list({
			pageSize: 50,
			pageToken: first.data.nextPageToken,
			universeId: "999",
		});
		assert(last.success);

		expect(last.data).toStrictEqual({ items: [], nextPageToken: undefined });
		expect(httpClient.requests.map((request) => request.request.url)).toStrictEqual([
			"/developer-products/v2/universes/999/developer-products/creator",
			"/developer-products/v2/universes/999/developer-products/creator?pageSize=50&pageToken=next+%2B%2F%3D",
		]);
	});
});
