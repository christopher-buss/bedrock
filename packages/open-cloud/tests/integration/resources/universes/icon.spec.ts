import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { UniversesClient } from "#src/resources/universes/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validIconListBody, validLocalizedIcon } from "#tests/helpers/game-icon";
import { assert, describe, expect, it } from "vitest";

describe(UniversesClient, () => {
	describe("icon", () => {
		describe("upload", () => {
			it("should return success with no payload when the server returns 200", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.icon.upload({
					image: new Uint8Array([1, 2, 3]),
					languageCode: "en_us",
					universeId: "1",
				});

				assert(result.success);

				expect(result.data).toBeUndefined();
			});

			it("should send a POST with a multipart FormData body to the localized icon URL", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				await client.icon.upload({
					image: new Uint8Array([1, 2, 3]),
					languageCode: "en_us",
					universeId: "1",
				});

				expect(httpClient.requests[0]?.request.method).toBe("POST");
				expect(httpClient.requests[0]?.request.url).toBe(
					"/legacy-game-internationalization/v1/game-icon/games/1/language-codes/en_us",
				);
			});

			it("should not retry a 5xx so a duplicate icon upload can't be created", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient()
					.mockApiError({ statusCode: 500 })
					.mockResponse({ body: {}, status: 200 });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.icon.upload({
					image: new Uint8Array([1, 2, 3]),
					languageCode: "en_us",
					universeId: "1",
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
				expect(httpClient.requests).toHaveLength(1);
			});
		});

		describe("delete", () => {
			it("should return success with undefined data when the server returns 200", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.icon.delete({
					languageCode: "fr_fr",
					universeId: "1",
				});

				assert(result.success);

				expect(result.data).toBeUndefined();
			});

			it("should send a DELETE to the localized icon URL", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				await client.icon.delete({ languageCode: "fr_fr", universeId: "1" });

				expect(httpClient.requests[0]?.request.method).toBe("DELETE");
				expect(httpClient.requests[0]?.request.url).toBe(
					"/legacy-game-internationalization/v1/game-icon/games/1/language-codes/fr_fr",
				);
			});

			it("should retry a 5xx because delete is idempotent", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient()
					.mockApiError({ statusCode: 500 })
					.mockResponse({ body: {}, status: 200 });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.icon.delete({ languageCode: "fr_fr", universeId: "1" });

				assert(result.success);

				expect(result.data).toBeUndefined();
				expect(httpClient.requests).toHaveLength(2);
			});
		});

		describe("list", () => {
			it("should return a parsed array of localized icons", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({
					body: validIconListBody({
						data: [
							validLocalizedIcon({ imageId: "1", languageCode: "en_us" }),
							validLocalizedIcon({ imageId: "2", languageCode: "fr_fr" }),
						],
					}),
					status: 200,
				});
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.icon.list({ universeId: "1" });

				assert(result.success);

				expect(result.data.map((icon) => icon.imageId)).toStrictEqual(["1", "2"]);
			});

			it("should send a GET to the universe-scoped icon URL", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockResponse({
					body: validIconListBody({ data: [] }),
					status: 200,
				});
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				await client.icon.list({ universeId: "67890" });

				expect(httpClient.requests[0]?.request.method).toBe("GET");
				expect(httpClient.requests[0]?.request.url).toBe(
					"/legacy-game-internationalization/v1/game-icon/games/67890",
				);
			});

			it("should propagate the http error when the request fails", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockApiError({
					message: "Not found",
					statusCode: 404,
				});
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.icon.list({ universeId: "1" });

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
				expect(result.err).toHaveProperty("statusCode", 404);
			});
		});

		describe("permission errors", () => {
			it("should surface a 403 on icon.upload as a PermissionError naming legacy-universe:manage", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.icon.upload({
					image: new Uint8Array([1, 2, 3]),
					languageCode: "en_us",
					universeId: "1",
				});

				assert(!result.success);
				assert(result.err instanceof PermissionError);

				expect(result.err.requiredScopes).toStrictEqual(["legacy-universe:manage"]);
				expect(result.err.operationKey).toBe("experience-icon");
			});

			it("should surface a 401 on icon.delete as a PermissionError", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockApiError({ statusCode: 401 });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.icon.delete({
					languageCode: "en_us",
					universeId: "1",
				});

				assert(!result.success);
				assert(result.err instanceof PermissionError);

				expect(result.err.requiredScopes).toStrictEqual(["legacy-universe:manage"]);
			});

			it("should surface a 403 on icon.list as a PermissionError", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
				const client = new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.icon.list({ universeId: "1" });

				assert(!result.success);
				assert(result.err instanceof PermissionError);

				expect(result.err.requiredScopes).toStrictEqual(["legacy-universe:manage"]);
			});
		});
	});
});
