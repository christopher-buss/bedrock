import { ApiError } from "#src/errors/api-error";
import { GamePassesClient } from "#src/resources/game-passes/index";
import type { GamePassConfigV2 } from "#src/resources/game-passes/wire";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { assert, describe, expect, it } from "vitest";

function validBody(overrides: Partial<GamePassConfigV2> = {}): GamePassConfigV2 {
	return {
		name: "Epic Pass",
		createdTimestamp: "2024-01-15T10:30:00.000Z",
		description: "Unlocks epic stuff",
		gamePassId: 12_345,
		iconAssetId: 67_890,
		isForSale: true,
		priceInformation: { defaultPriceInRobux: 100, enabledFeatures: [] },
		updatedTimestamp: "2024-03-20T14:45:00.000Z",
		...overrides,
	};
}

describe(GamePassesClient, () => {
	describe("get", () => {
		it("should return a parsed GamePass on success", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validBody(),
				status: 200,
			});
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ gamePassId: "12345", universeId: "1" });

			assert(result.success);

			expect(result.data.id).toBe("12345");
			expect(result.data.name).toBe("Epic Pass");
		});

		it("should propagate the http error when the request fails", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({
				code: "NotFound",
				message: "Game pass not found",
				statusCode: 404,
			});
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.get({ gamePassId: "12345", universeId: "1" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).toHaveProperty("statusCode", 404);
		});

		it("should build the request config with defaults when only apiKey is provided", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validBody(),
				status: 200,
			});
			const client = new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.get({ gamePassId: "12345", universeId: "1" });

			expect(httpClient.requests[0]?.config).toStrictEqual({
				apiKey: "test-key",
				baseUrl: "https://apis.roblox.com",
				timeout: 30_000,
			});
		});

		it("should forward the configured apiKey, baseUrl, and timeout to the request config", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validBody(),
				status: 200,
			});
			const client = new GamePassesClient({
				apiKey: "configured-key",
				baseUrl: "https://staging.apis.roblox.com",
				httpClient,
				sleep: createFakeSleep(),
				timeout: 5000,
			});

			await client.get({ gamePassId: "12345", universeId: "1" });

			expect(httpClient.requests[0]?.config).toStrictEqual({
				apiKey: "configured-key",
				baseUrl: "https://staging.apis.roblox.com",
				timeout: 5000,
			});
		});
	});
});
