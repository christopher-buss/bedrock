import { validIconListBody, validLocalizedIcon } from "#tests/helpers/game-icon";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseIconListResponse } from "./parsers.ts";

describe(parseIconListResponse, () => {
	it("should return success with a single converted entry for a valid body", () => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: validIconListBody(),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data).toStrictEqual([
			{
				imageId: "12345",
				imageUrl: "https://t1.rbxcdn.com/icon/12345",
				languageCode: "en-us",
				state: "Approved",
			},
		]);
	});

	it("should preserve the order of entries returned by the API", () => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: validIconListBody({
				data: [
					validLocalizedIcon({ imageId: "1", languageCode: "en-us" }),
					validLocalizedIcon({ imageId: "2", languageCode: "fr-fr" }),
					validLocalizedIcon({ imageId: "3", languageCode: "es-es" }),
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

	it.for<["Approved" | "Error" | "PendingReview" | "Rejected" | "UnAvailable"]>([
		["Approved"],
		["Error"],
		["PendingReview"],
		["Rejected"],
		["UnAvailable"],
	])("should accept the %s state value", ([state]) => {
		expect.assertions(1);

		const result = parseIconListResponse({
			body: validIconListBody({ data: [validLocalizedIcon({ state })] }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data[0]?.state).toBe(state);
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
		{
			badEntry: '{ "imageUrl": "u", "languageCode": "en-us", "state": "Approved" }',
			label: "an entry is missing imageId",
		},
		{
			badEntry: '{ "imageId": "1", "languageCode": "en-us", "state": "Approved" }',
			label: "an entry is missing imageUrl",
		},
		{
			badEntry: '{ "imageId": "1", "imageUrl": "u", "state": "Approved" }',
			label: "an entry is missing languageCode",
		},
		{
			badEntry: '{ "imageId": "1", "imageUrl": "u", "languageCode": "en-us" }',
			label: "an entry is missing state",
		},
		{
			badEntry:
				'{ "imageId": 1, "imageUrl": "u", "languageCode": "en-us", "state": "Approved" }',
			label: "imageId has the wrong type",
		},
		{
			badEntry:
				'{ "imageId": "1", "imageUrl": 2, "languageCode": "en-us", "state": "Approved" }',
			label: "imageUrl has the wrong type",
		},
		{
			badEntry:
				'{ "imageId": "1", "imageUrl": "u", "languageCode": 42, "state": "Approved" }',
			label: "languageCode has the wrong type",
		},
		{
			badEntry:
				'{ "imageId": "1", "imageUrl": "u", "languageCode": "en-us", "state": "Unknown" }',
			label: "state is not a recognized value",
		},
		{
			badEntry: '{ "imageId": "1", "imageUrl": "u", "languageCode": "en-us", "state": 0 }',
			label: "state has the wrong type",
		},
	])("should return an ApiError when $label", ({ badEntry }) => {
		expect.assertions(1);

		const body = JSON.parse(`{ "data": [${badEntry}] }`);

		const result = parseIconListResponse({ body, headers: {}, status: 422 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});
});
