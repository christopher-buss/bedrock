import {
	validIconListBody,
	validIconUploadBody,
	validLocalizedIcon,
} from "#tests/helpers/experience-icon";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import {
	parseIconDeleteResponse,
	parseIconListResponse,
	parseIconUploadResponse,
} from "./parsers.ts";

describe(parseIconUploadResponse, () => {
	it("should return success with the stringified mediaAssetId for a valid body", () => {
		expect.assertions(1);

		const result = parseIconUploadResponse({
			body: validIconUploadBody({ mediaAssetId: 12_345 }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data).toStrictEqual({ mediaAssetId: "12345" });
	});

	it("should stringify a different mediaAssetId from the same body shape", () => {
		expect.assertions(1);

		const result = parseIconUploadResponse({
			body: validIconUploadBody({ mediaAssetId: 987_654 }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.mediaAssetId).toBe("987654");
	});

	it("should return an ApiError when the body is not an object", () => {
		expect.assertions(2);

		const result = parseIconUploadResponse({
			body: "not an object",
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed icon upload response");
	});

	it("should return an ApiError when the body is JSON null", () => {
		expect.assertions(1);

		const result = parseIconUploadResponse({
			body: JSON.parse("null"),
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError surfacing the response status when mediaAssetId is missing", () => {
		expect.assertions(2);

		const result = parseIconUploadResponse({
			body: {},
			headers: {},
			status: 502,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.statusCode).toBe(502);
	});

	it("should return an ApiError when mediaAssetId is a string instead of a number", () => {
		expect.assertions(1);

		const result = parseIconUploadResponse({
			body: { mediaAssetId: "12345" },
			headers: {},
			status: 422,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});
});

describe(parseIconDeleteResponse, () => {
	it("should return success with undefined data", () => {
		expect.assertions(2);

		const result = parseIconDeleteResponse();

		assert(result.success);

		expect(result.data).toBeUndefined();
		expect(result.success).toBeTrue();
	});
});

describe(parseIconListResponse, () => {
	it("should return success with a single converted entry for a valid body", () => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: validIconListBody(),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data).toStrictEqual([{ languageCode: "en-us", mediaAssetId: "12345" }]);
	});

	it("should preserve the order of entries returned by the API", () => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: validIconListBody({
				data: [
					validLocalizedIcon({ languageCode: "en-us", mediaAssetId: 1 }),
					validLocalizedIcon({ languageCode: "fr-fr", mediaAssetId: 2 }),
					validLocalizedIcon({ languageCode: "es-es", mediaAssetId: 3 }),
				],
			}),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.map((entry) => entry.languageCode)).toStrictEqual([
			"en-us",
			"fr-fr",
			"es-es",
		]);
	});

	it("should stringify each entry's int64 mediaAssetId", () => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: validIconListBody({
				data: [
					validLocalizedIcon({ mediaAssetId: 1 }),
					validLocalizedIcon({ mediaAssetId: 999_999 }),
				],
			}),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.map((entry) => entry.mediaAssetId)).toStrictEqual(["1", "999999"]);
	});

	it("should return success with an empty array when the API returns no entries", () => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: validIconListBody({ data: [] }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data).toStrictEqual([]);
	});

	it("should return an ApiError when the body is not an object", () => {
		expect.assertions(2);

		const result = parseIconListResponse({
			body: "not an object",
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed icon list response");
	});

	it("should return an ApiError when the body is JSON null", () => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: JSON.parse("null"),
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when `data` is missing", () => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: {},
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when `data` is not an array", () => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: { data: { not: "an array" } },
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it.for([
		{ badEntry: "null", label: "an entry is JSON null" },
		{ badEntry: '"plain string"', label: "an entry is not an object" },
		{ badEntry: '{ "languageCode": "en-us" }', label: "an entry is missing mediaAssetId" },
		{ badEntry: '{ "mediaAssetId": 1 }', label: "an entry is missing languageCode" },
		{
			badEntry: '{ "languageCode": 42, "mediaAssetId": 1 }',
			label: "languageCode has the wrong type",
		},
		{
			badEntry: '{ "languageCode": "en-us", "mediaAssetId": "1" }',
			label: "mediaAssetId has the wrong type",
		},
	])("should return an ApiError when $label", ({ badEntry }) => {
		expect.assertions(1);

		const body = JSON.parse(`{ "data": [${badEntry}] }`);

		const result = parseIconListResponse({ body, headers: {}, status: 422 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});
});
