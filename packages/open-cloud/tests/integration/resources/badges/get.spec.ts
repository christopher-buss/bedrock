import { assert, describe, it } from "vitest";

import { BadgesClient } from "#src/resources/badges/index";
import { validBadgeDetailsBody } from "#tests/helpers/badges";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

describe("badges get", () => {
	it("should read a badge from badges.roblox.com with no credential", async ({ expect }) => {
		expect.assertions(4);

		const httpClient = createFakeHttpClient().mockResponse({
			body: validBadgeDetailsBody({ enabled: false }),
			status: 200,
		});
		const client = new BadgesClient({
			credential: { apiKey: "key", kind: "apiKey" },
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.get({ badgeId: "12345" });
		assert(result.success);

		expect(result.data).toMatchObject({ id: "12345", enabled: false });
		expect(httpClient.requests[0]!.request).toStrictEqual({
			method: "GET",
			url: "/v1/badges/12345",
		});
		expect(httpClient.requests[0]!.config).toMatchObject({
			baseUrl: "https://badges.roblox.com",
			credential: { kind: "none" },
		});
		expect(httpClient.requests[0]!.request.headers).toBeUndefined();
	});
});
