import { assert, describe, it } from "vitest";

import { PlacesClient } from "#src/resources/places/client";
import { loadFixture } from "#tests/conformance/_helpers";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";

describe("place root lookup", () => {
	it("should read the genuine root flag from a captured place response without writing", async ({
		expect,
	}) => {
		expect.assertions(2);

		const http = createFakeHttpClient().mockResponse({
			body: loadFixture("places", "get-response.json"),
			status: 200,
		});
		const client = new PlacesClient({
			credential: { apiKey: "fake", kind: "apiKey" },
			httpClient: http,
		});
		const result = await client.get({ placeId: "456", universeId: "123" });
		assert(result.success);

		expect(result.data).toMatchObject({ id: "456", root: true, universeId: "123" });
		expect(
			http.requests.map(({ request }) => [request.method, request.url, request.body]),
		).toStrictEqual([["GET", "/cloud/v2/universes/123/places/456", undefined]]);
	});
});
