import { assert, describe, expect, it } from "vitest";

import { ValidationError } from "../../../errors/validation.ts";
import {
	buildDeleteThumbnailRequest,
	buildReorderThumbnailsRequest,
	buildUploadThumbnailRequest,
} from "./builders.ts";
import type {
	DeleteExperienceThumbnailParameters,
	ReorderExperienceThumbnailsParameters,
	UploadExperienceThumbnailParameters,
} from "./types.ts";

describe(buildUploadThumbnailRequest, () => {
	it("should use the POST method", () => {
		expect.assertions(1);

		const parameters = {
			image: new Uint8Array([1, 2, 3]),
			languageCode: "en_us",
			universeId: "67890",
		} satisfies UploadExperienceThumbnailParameters;

		const request = buildUploadThumbnailRequest(parameters);

		expect(request.method).toBe("POST");
	});

	it("should interpolate universeId and languageCode into the upload URL", () => {
		expect.assertions(1);

		const parameters = {
			image: new Uint8Array([1, 2, 3]),
			languageCode: "fr_fr",
			universeId: "67890",
		} satisfies UploadExperienceThumbnailParameters;

		const request = buildUploadThumbnailRequest(parameters);

		expect(request.url).toBe(
			"/legacy-game-internationalization/v1/game-thumbnails/games/67890/language-codes/fr_fr/image",
		);
	});

	it("should append the image as the `gameThumbnailRequest.files` field on a FormData body", () => {
		expect.assertions(1);

		const parameters = {
			image: new Uint8Array([1, 2, 3]),
			languageCode: "en_us",
			universeId: "67890",
		} satisfies UploadExperienceThumbnailParameters;

		const request = buildUploadThumbnailRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("gameThumbnailRequest.files")).toBeTrue();
	});

	it("should wrap a Uint8Array image into a Blob preserving its bytes", () => {
		expect.assertions(2);

		const image = new Uint8Array([1, 2, 3, 4]);
		const parameters = {
			image,
			languageCode: "en_us",
			universeId: "67890",
		} satisfies UploadExperienceThumbnailParameters;

		const request = buildUploadThumbnailRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("gameThumbnailRequest.files");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.size).toBe(image.byteLength);
	});

	it("should preserve the MIME type of a Blob image", () => {
		expect.assertions(1);

		const image = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
		const parameters = {
			image,
			languageCode: "en_us",
			universeId: "67890",
		} satisfies UploadExperienceThumbnailParameters;

		const request = buildUploadThumbnailRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("gameThumbnailRequest.files");
		assert(appended instanceof Blob);

		expect(appended.type).toBe("image/png");
	});
});

describe(buildDeleteThumbnailRequest, () => {
	it("should use the DELETE method", () => {
		expect.assertions(1);

		const parameters = {
			imageId: "12345",
			languageCode: "en_us",
			universeId: "67890",
		} satisfies DeleteExperienceThumbnailParameters;

		const request = buildDeleteThumbnailRequest(parameters);

		expect(request.method).toBe("DELETE");
	});

	it("should interpolate universeId, languageCode, and imageId into the delete URL", () => {
		expect.assertions(1);

		const parameters = {
			imageId: "12345",
			languageCode: "es_es",
			universeId: "67890",
		} satisfies DeleteExperienceThumbnailParameters;

		const request = buildDeleteThumbnailRequest(parameters);

		expect(request.url).toBe(
			"/legacy-game-internationalization/v1/game-thumbnails/games/67890/language-codes/es_es/images/12345",
		);
	});

	it("should not set a body", () => {
		expect.assertions(1);

		const parameters = {
			imageId: "12345",
			languageCode: "en_us",
			universeId: "67890",
		} satisfies DeleteExperienceThumbnailParameters;

		const request = buildDeleteThumbnailRequest(parameters);

		expect(request.body).toBeUndefined();
	});
});

describe(buildReorderThumbnailsRequest, () => {
	it("should return success with a JSON body containing parsed mediaAssetIds in order", () => {
		expect.assertions(2);

		const parameters = {
			languageCode: "en_us",
			orderedImageIds: ["1", "2", "3"],
			universeId: "67890",
		} satisfies ReorderExperienceThumbnailsParameters;

		const result = buildReorderThumbnailsRequest(parameters);

		assert(result.success);

		expect(result.data.method).toBe("POST");
		expect(result.data.body).toStrictEqual({ mediaAssetIds: [1, 2, 3] });
	});

	it("should interpolate universeId and languageCode into the order URL", () => {
		expect.assertions(1);

		const parameters = {
			languageCode: "fr_fr",
			orderedImageIds: ["42"],
			universeId: "67890",
		} satisfies ReorderExperienceThumbnailsParameters;

		const result = buildReorderThumbnailsRequest(parameters);

		assert(result.success);

		expect(result.data.url).toBe(
			"/legacy-game-internationalization/v1/game-thumbnails/games/67890/language-codes/fr_fr/images/order",
		);
	});

	it("should reject an empty orderedImageIds array with code empty_image_ids", () => {
		expect.assertions(3);

		const parameters = {
			languageCode: "en_us",
			orderedImageIds: [],
			universeId: "67890",
		} satisfies ReorderExperienceThumbnailsParameters;

		const result = buildReorderThumbnailsRequest(parameters);

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ValidationError);
		expect(result.err.code).toBe("empty_image_ids");
		expect(result.err.message).toBe("orderedImageIds must contain at least one image ID");
	});

	it.for([
		{ id: "abc", label: "non-numeric string" },
		{ id: "", label: "empty string" },
		{ id: " 12345", label: "leading whitespace" },
		{ id: "12345 ", label: "trailing whitespace" },
		{ id: "0", label: "zero" },
		{ id: "-1", label: "negative number" },
		{ id: "1.5", label: "decimal number" },
		{ id: "1e3", label: "scientific notation" },
		{ id: "9007199254740993", label: "value beyond MAX_SAFE_INTEGER" },
	])("should reject $label with code invalid_image_id", ({ id }) => {
		expect.assertions(3);

		const parameters = {
			languageCode: "en_us",
			orderedImageIds: [id],
			universeId: "67890",
		} satisfies ReorderExperienceThumbnailsParameters;

		const result = buildReorderThumbnailsRequest(parameters);

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ValidationError);
		expect(result.err.code).toBe("invalid_image_id");
		expect(result.err.message).toBe(
			`orderedImageIds entry ${JSON.stringify(id)} is not a positive integer ID`,
		);
	});

	it("should reject the first invalid id even when later ids are valid", () => {
		expect.assertions(1);

		const parameters = {
			languageCode: "en_us",
			orderedImageIds: ["1", "bad", "3"],
			universeId: "67890",
		} satisfies ReorderExperienceThumbnailsParameters;

		const result = buildReorderThumbnailsRequest(parameters);

		assert(!result.success);

		expect(result.err.code).toBe("invalid_image_id");
	});
});
