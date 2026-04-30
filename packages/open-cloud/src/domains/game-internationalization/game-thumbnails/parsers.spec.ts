import { validThumbnailUploadBody } from "#tests/helpers/game-thumbnails";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseThumbnailUploadResponse } from "./parsers.ts";

describe(parseThumbnailUploadResponse, () => {
	it("should return success with the mediaAssetId for a valid body", () => {
		expect.assertions(1);

		const result = parseThumbnailUploadResponse({
			body: validThumbnailUploadBody({ mediaAssetId: "67890" }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data).toStrictEqual({ mediaAssetId: "67890" });
	});

	it("should pass through a different mediaAssetId from the same body shape", () => {
		expect.assertions(1);

		const result = parseThumbnailUploadResponse({
			body: validThumbnailUploadBody({ mediaAssetId: "999999" }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.mediaAssetId).toBe("999999");
	});

	it("should return an ApiError when the body is not an object", () => {
		expect.assertions(2);

		const result = parseThumbnailUploadResponse({
			body: "not an object",
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed thumbnail upload response");
	});

	it("should return an ApiError when the body is JSON null", () => {
		expect.assertions(1);

		const result = parseThumbnailUploadResponse({
			body: JSON.parse("null"),
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError surfacing the response status when mediaAssetId is missing", () => {
		expect.assertions(2);

		const result = parseThumbnailUploadResponse({
			body: {},
			headers: {},
			status: 502,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.statusCode).toBe(502);
	});

	it("should return an ApiError when mediaAssetId is a number instead of a string", () => {
		expect.assertions(1);

		const result = parseThumbnailUploadResponse({
			body: { mediaAssetId: 67_890 },
			headers: {},
			status: 422,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});
});
