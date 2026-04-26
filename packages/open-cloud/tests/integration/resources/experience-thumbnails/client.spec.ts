import { ApiError } from "#src/errors/api-error";
import { ValidationError } from "#src/errors/validation";
import { ExperienceThumbnailsClient } from "#src/resources/experience-thumbnails/index";
import { validThumbnailUploadBody } from "#tests/helpers/experience-thumbnails";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { assert, describe, expect, it } from "vitest";

describe(ExperienceThumbnailsClient, () => {
	describe("upload", () => {
		it("should return a parsed UploadedExperienceThumbnail on success", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validThumbnailUploadBody({ mediaAssetId: "67890" }),
				status: 200,
			});
			const client = new ExperienceThumbnailsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.upload({
				image: new Uint8Array([1, 2, 3]),
				languageCode: "en-us",
				universeId: "1",
			});

			assert(result.success);

			expect(result.data).toStrictEqual({ mediaAssetId: "67890" });
		});

		it("should send a POST with multipart FormData to the localized thumbnail URL", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validThumbnailUploadBody(),
				status: 200,
			});
			const client = new ExperienceThumbnailsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.upload({
				image: new Uint8Array([1, 2, 3]),
				languageCode: "en-us",
				universeId: "1",
			});

			expect(httpClient.requests[0]?.request.method).toBe("POST");
			expect(httpClient.requests[0]?.request.url).toBe(
				"/legacy-game-internationalization/v1/game-thumbnails/games/1/language-codes/en-us/image",
			);
		});

		it("should not retry a 5xx so a duplicate carousel entry can't be created", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: validThumbnailUploadBody(), status: 200 });
			const client = new ExperienceThumbnailsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.upload({
				image: new Uint8Array([1, 2, 3]),
				languageCode: "en-us",
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
			const client = new ExperienceThumbnailsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.delete({
				imageId: "12345",
				languageCode: "en-us",
				universeId: "1",
			});

			assert(result.success);

			expect(result.data).toBeUndefined();
		});

		it("should send a DELETE to the imageId-scoped thumbnail URL", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
			const client = new ExperienceThumbnailsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.delete({ imageId: "12345", languageCode: "en-us", universeId: "1" });

			expect(httpClient.requests[0]?.request.method).toBe("DELETE");
			expect(httpClient.requests[0]?.request.url).toBe(
				"/legacy-game-internationalization/v1/game-thumbnails/games/1/language-codes/en-us/images/12345",
			);
		});
	});

	describe("reorder", () => {
		it("should return success with undefined data when the server returns 200", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
			const client = new ExperienceThumbnailsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.reorder({
				languageCode: "en-us",
				orderedImageIds: ["1", "2", "3"],
				universeId: "1",
			});

			assert(result.success);

			expect(result.data).toBeUndefined();
		});

		it("should send a JSON-bodied POST with parsed mediaAssetIds in the supplied order", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
			const client = new ExperienceThumbnailsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.reorder({
				languageCode: "en-us",
				orderedImageIds: ["3", "1", "2"],
				universeId: "1",
			});

			expect(httpClient.requests[0]?.request.method).toBe("POST");
			expect(httpClient.requests[0]?.request.url).toBe(
				"/legacy-game-internationalization/v1/game-thumbnails/games/1/language-codes/en-us/images/order",
			);
			expect(httpClient.requests[0]?.request.body).toStrictEqual({
				mediaAssetIds: [3, 1, 2],
			});
		});

		it("should reject locally when an image id is invalid without sending the request", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient();
			const client = new ExperienceThumbnailsClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.reorder({
				languageCode: "en-us",
				orderedImageIds: ["not-a-number"],
				universeId: "1",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err).toHaveProperty("code", "invalid_image_id");
			expect(httpClient.requests).toHaveLength(0);
		});
	});
});
