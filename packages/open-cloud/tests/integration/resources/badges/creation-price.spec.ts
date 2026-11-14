import { assert, describe, it } from "vitest";

import { UnexpectedResponseError } from "#src/errors/unexpected-response";
import { BadgesClient } from "#src/resources/badges/index";
import { loadFixture } from "#tests/conformance/_helpers";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

describe(BadgesClient, () => {
	describe("getCreationPrice", () => {
		it("should read the live badge creation price from badges.roblox.com with no credential", async ({
			expect,
		}) => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient().mockResponse({
				body: loadFixture("badges", "metadata-response.json"),
				status: 200,
			});
			const client = new BadgesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.getCreationPrice();

			assert(result.success);

			expect(result.data).toBe(100);
			expect(httpClient.requests[0]!.request).toStrictEqual({
				method: "GET",
				url: "/v1/badges/metadata",
			});
			expect(httpClient.requests[0]!.config).toMatchObject({
				baseUrl: "https://badges.roblox.com",
				credential: { kind: "none" },
			});
			expect(httpClient.requests[0]!.request.headers).toBeUndefined();
		});

		it("should read a price of zero as a free create", async ({ expect }) => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: { badgeCreationPrice: 0 },
				status: 200,
			});
			const client = new BadgesClient({
				credential: { kind: "none" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.getCreationPrice();

			expect(result).toStrictEqual({ data: 0, success: true });
		});

		it.for([
			{ body: {}, kind: "missing" },
			{ body: { badgeCreationPrice: -1 }, kind: "negative" },
			{ body: { badgeCreationPrice: 1.5 }, kind: "fractional" },
			{ body: { badgeCreationPrice: "100" }, kind: "a string" },
			{ body: 100, kind: "a bare body number" },
			{ body: undefined, kind: "an empty body" },
		])(
			"should return a response error when the price is $kind, not throw",
			async ({ body }, { expect }) => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
					body,
					status: 200,
				});
				const client = new BadgesClient({
					credential: { kind: "none" },
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.getCreationPrice();

				assert(!result.success);

				expect(result.err).toBeInstanceOf(UnexpectedResponseError);
				expect(result.err.message).toContain("Malformed badge metadata response");
			},
		);
	});
});
