import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { GamePassesClient } from "#src/resources/game-passes/index";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { assert, describe, expect, it } from "vitest";

const VALID_NAME_DESCRIPTION_BODY = { name: "Epic Pass", description: "Unlocks epic stuff" };

describe(GamePassesClient, () => {
	describe("localization", () => {
		describe("updateNameDescription", () => {
			it("should return success with no payload when the server returns 200", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({
					body: VALID_NAME_DESCRIPTION_BODY,
					status: 200,
				});
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.updateNameDescription({
					name: "Epic Pass",
					gamePassId: "12345",
					languageCode: "fr_fr",
				});

				assert(result.success);

				expect(result.data).toBeUndefined();
			});

			it("should send a PATCH with a JSON body to the localized name-description URL", async () => {
				expect.assertions(3);

				const httpClient = createFakeHttpClient().mockResponse({
					body: VALID_NAME_DESCRIPTION_BODY,
					status: 200,
				});
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				await client.localization.updateNameDescription({
					name: "Epic Pass",
					description: "Unlocks epic stuff",
					gamePassId: "12345",
					languageCode: "fr_fr",
				});

				expect(httpClient.requests[0]?.request.method).toBe("PATCH");
				expect(httpClient.requests[0]?.request.url).toBe(
					"/legacy-game-internationalization/v1/game-passes/12345/name-description/language-codes/fr_fr",
				);
				expect(httpClient.requests[0]?.request.body).toStrictEqual({
					name: "Epic Pass",
					description: "Unlocks epic stuff",
				});
			});

			it("should retry a 5xx since the PATCH is idempotent", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient()
					.mockApiError({ statusCode: 500 })
					.mockResponse({ body: VALID_NAME_DESCRIPTION_BODY, status: 200 });
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.updateNameDescription({
					name: "Epic Pass",
					gamePassId: "12345",
					languageCode: "fr_fr",
				});

				assert(result.success);

				expect(httpClient.requests).toHaveLength(2);
			});

			it("should surface a 403 as a PermissionError naming legacy-game-pass:manage", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.updateNameDescription({
					name: "Epic Pass",
					gamePassId: "12345",
					languageCode: "fr_fr",
				});

				assert(!result.success);
				assert(result.err instanceof PermissionError);

				expect(result.err.requiredScopes).toStrictEqual(["legacy-game-pass:manage"]);
				expect(result.err.operationKey).toBe("game-pass-localization");
			});

			it("should propagate a 404 as an ApiError", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockApiError({
					message: "Game pass not found",
					statusCode: 404,
				});
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.updateNameDescription({
					name: "Epic Pass",
					gamePassId: "12345",
					languageCode: "fr_fr",
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
				expect(result.err).toHaveProperty("statusCode", 404);
			});
		});

		describe("uploadIcon", () => {
			it("should return success with no payload when the server returns 200", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.uploadIcon({
					gamePassId: "12345",
					image: new Uint8Array([1, 2, 3]),
					languageCode: "fr_fr",
				});

				assert(result.success);

				expect(result.data).toBeUndefined();
			});

			it("should send a POST with multipart FormData to the localized icon URL", async () => {
				expect.assertions(3);

				const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				await client.localization.uploadIcon({
					gamePassId: "12345",
					image: new Uint8Array([1, 2, 3]),
					languageCode: "fr_fr",
				});

				expect(httpClient.requests[0]?.request.method).toBe("POST");
				expect(httpClient.requests[0]?.request.url).toBe(
					"/legacy-game-internationalization/v1/game-passes/12345/icons/language-codes/fr_fr",
				);
				expect(httpClient.requests[0]?.request.body).toBeInstanceOf(FormData);
			});

			it("should not retry a 5xx so a duplicate icon upload can't be created", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient()
					.mockApiError({ statusCode: 500 })
					.mockResponse({ body: {}, status: 200 });
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.uploadIcon({
					gamePassId: "12345",
					image: new Uint8Array([1, 2, 3]),
					languageCode: "fr_fr",
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
				expect(httpClient.requests).toHaveLength(1);
			});

			it("should surface a 403 as a PermissionError naming legacy-game-pass:manage", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.uploadIcon({
					gamePassId: "12345",
					image: new Uint8Array([1, 2, 3]),
					languageCode: "fr_fr",
				});

				assert(!result.success);
				assert(result.err instanceof PermissionError);

				expect(result.err.requiredScopes).toStrictEqual(["legacy-game-pass:manage"]);
				expect(result.err.operationKey).toBe("game-pass-localization");
			});
		});

		describe("shared rate-limit bucket", () => {
			it("should serialize updateNameDescription and uploadIcon through the same per-API-key queue", async () => {
				expect.assertions(2);

				// At 100/60 per second the bucket holds one full token (600ms
				// of latency budget) of headroom, so the first call goes
				// through immediately and the second pays a 200ms wait
				// against the drained shared bucket. Two independent buckets
				// would each go through wait-free, so the recorded wait
				// proves the methods queue against one operationKey.
				const httpClient = createFakeHttpClient()
					.mockResponse({ body: VALID_NAME_DESCRIPTION_BODY, status: 200 })
					.mockResponse({ body: {}, status: 200 });
				const clock = createFakeClock();
				const client = new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: clock.sleep,
				});

				await client.localization.updateNameDescription({
					name: "Epic Pass",
					gamePassId: "12345",
					languageCode: "fr_fr",
				});
				await client.localization.uploadIcon({
					gamePassId: "12345",
					image: new Uint8Array([1, 2, 3]),
					languageCode: "fr_fr",
				});

				expect(httpClient.requests).toHaveLength(2);
				expect(clock.waits).toStrictEqual([200]);
			});
		});
	});
});
