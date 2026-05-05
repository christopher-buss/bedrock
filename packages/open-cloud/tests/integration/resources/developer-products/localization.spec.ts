import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { DeveloperProductsClient } from "#src/resources/developer-products/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { assert, describe, expect, it } from "vitest";

const VALID_NAME_DESCRIPTION_BODY = { name: "Gem Pack", description: "Premium gems" };

describe(DeveloperProductsClient, () => {
	describe("localization", () => {
		describe("updateNameDescription", () => {
			it("should return success with no payload when the server returns 200", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({
					body: VALID_NAME_DESCRIPTION_BODY,
					status: 200,
				});
				const client = new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.updateNameDescription({
					name: "Gem Pack",
					languageCode: "fr-fr",
					productId: "12345",
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
				const client = new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				await client.localization.updateNameDescription({
					name: "Gem Pack",
					description: "Premium gems",
					languageCode: "fr-fr",
					productId: "12345",
				});

				expect(httpClient.requests[0]?.request.method).toBe("PATCH");
				expect(httpClient.requests[0]?.request.url).toBe(
					"/legacy-game-internationalization/v1/developer-products/12345/name-description/language-codes/fr-fr",
				);
				expect(httpClient.requests[0]?.request.body).toStrictEqual({
					name: "Gem Pack",
					description: "Premium gems",
				});
			});

			it("should retry a 5xx since the PATCH is idempotent", async () => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient()
					.mockApiError({ statusCode: 500 })
					.mockResponse({ body: VALID_NAME_DESCRIPTION_BODY, status: 200 });
				const client = new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.updateNameDescription({
					name: "Gem Pack",
					languageCode: "fr-fr",
					productId: "12345",
				});

				assert(result.success);

				expect(httpClient.requests).toHaveLength(2);
			});

			it("should surface a 403 as a PermissionError naming legacy-developer-product:manage", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
				const client = new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.updateNameDescription({
					name: "Gem Pack",
					languageCode: "fr-fr",
					productId: "12345",
				});

				assert(!result.success);
				assert(result.err instanceof PermissionError);

				expect(result.err.requiredScopes).toStrictEqual([
					"legacy-developer-product:manage",
				]);
				expect(result.err.operationKey).toBe("developer-product-localization");
			});

			it("should propagate a 404 as an ApiError", async () => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockApiError({
					message: "Developer product not found",
					statusCode: 404,
				});
				const client = new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.localization.updateNameDescription({
					name: "Gem Pack",
					languageCode: "fr-fr",
					productId: "12345",
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
				expect(result.err).toHaveProperty("statusCode", 404);
			});
		});
	});
});
