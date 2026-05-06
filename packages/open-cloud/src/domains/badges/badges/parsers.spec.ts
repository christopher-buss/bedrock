import { validBadgeBody } from "#tests/helpers/badges";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseBadgeResponse } from "./parsers.ts";

describe(parseBadgeResponse, () => {
	it("should return success with a fully converted Badge for a valid body", () => {
		expect.assertions(1);

		const body = validBadgeBody();

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "12345",
			name: "First Goal",
			awarder: { id: "222", name: "Lobby", type: "Place" },
			createdAt: new Date("2024-01-15T10:30:00.000Z"),
			description: "Awarded on first login.",
			displayDescription: "Awarded on first login.",
			displayIconImageId: "67890",
			displayName: "First Goal",
			enabled: true,
			iconImageId: "67890",
			statistics: { awardedCount: 100, pastDayAwardedCount: 5, winRatePercentage: 42.5 },
			updatedAt: new Date("2024-03-20T14:45:00.000Z"),
		});
	});

	it("should treat iconImageId 0 as an absent source icon", () => {
		expect.assertions(1);

		const body = validBadgeBody({ iconImageId: 0 });

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.iconImageId).toBeUndefined();
	});

	it("should treat displayIconImageId 0 as an absent localized icon", () => {
		expect.assertions(1);

		const body = validBadgeBody({ displayIconImageId: 0 });

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.displayIconImageId).toBeUndefined();
	});

	it("should stringify a nonzero iconImageId", () => {
		expect.assertions(1);

		const body = validBadgeBody({ iconImageId: 99_999 });

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.iconImageId).toBe("99999");
	});

	it("should map the numeric awarder type 1 to the Place label", () => {
		expect.assertions(1);

		const body = validBadgeBody({ awarder: { id: 333, name: "Arena", type: 1 } });

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.awarder).toStrictEqual({
			id: "333",
			name: "Arena",
			type: "Place",
		});
	});

	it("should preserve statistics on the converted Badge", () => {
		expect.assertions(1);

		const body = validBadgeBody({
			statistics: { awardedCount: 7, pastDayAwardedCount: 1, winRatePercentage: 12.5 },
		});

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.statistics).toStrictEqual({
			awardedCount: 7,
			pastDayAwardedCount: 1,
			winRatePercentage: 12.5,
		});
	});

	it("should convert created into a createdAt Date at the same instant", () => {
		expect.assertions(1);

		const body = validBadgeBody({ created: "2024-05-01T08:00:00.000Z" });

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.createdAt.toISOString()).toBe("2024-05-01T08:00:00.000Z");
	});

	it("should convert updated into an updatedAt Date at the same instant", () => {
		expect.assertions(1);

		const body = validBadgeBody({ updated: "2024-07-14T18:30:00.000Z" });

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.updatedAt.toISOString()).toBe("2024-07-14T18:30:00.000Z");
	});

	it("should stringify the numeric badge id into the public id", () => {
		expect.assertions(1);

		const body = validBadgeBody({ id: 987_654 });

		const result = parseBadgeResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.id).toBe("987654");
	});

	it("should return an ApiError when a required field is missing", () => {
		expect.assertions(3);

		const body = JSON.parse(
			`{
				"awarder": { "id": 222, "name": "Lobby", "type": 1 },
				"created": "2024-01-15T10:30:00.000Z",
				"description": "nameless",
				"displayDescription": "nameless",
				"displayIconImageId": 0,
				"displayName": "nameless",
				"enabled": true,
				"iconImageId": 0,
				"id": 12345,
				"statistics": { "awardedCount": 0, "pastDayAwardedCount": 0, "winRatePercentage": 0 },
				"updated": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseBadgeResponse({ body, headers: {}, status: 422 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed badge response");
		expect(result.err.statusCode).toBe(422);
	});

	it.for([
		{ badValue: '"12345"', field: "id" },
		{ badValue: "42", field: "name" },
		{ badValue: "false", field: "description" },
		{ badValue: "false", field: "displayName" },
		{ badValue: "false", field: "displayDescription" },
		{ badValue: '"yes"', field: "enabled" },
		{ badValue: '"67890"', field: "iconImageId" },
		{ badValue: '"67890"', field: "displayIconImageId" },
		{ badValue: "12345", field: "created" },
		{ badValue: "12345", field: "updated" },
	])("should return an ApiError when $field has the wrong type", ({ badValue, field }) => {
		expect.assertions(2);

		const body = JSON.parse(
			`{
					"awarder": { "id": 222, "name": "Lobby", "type": 1 },
					"created": "2024-01-15T10:30:00.000Z",
					"description": "base",
					"displayDescription": "base",
					"displayIconImageId": 0,
					"displayName": "base",
					"enabled": true,
					"iconImageId": 0,
					"id": 1,
					"name": "base",
					"statistics": { "awardedCount": 0, "pastDayAwardedCount": 0, "winRatePercentage": 0 },
					"updated": "2024-03-20T14:45:00.000Z",
					"${field}": ${badValue}
				}`,
		);

		const result = parseBadgeResponse({ body, headers: {}, status: 502 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.statusCode).toBe(502);
	});

	it("should return an ApiError when the body is not an object", () => {
		expect.assertions(1);

		const result = parseBadgeResponse({ body: "not an object", headers: {}, status: 500 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when the body is JSON null", () => {
		expect.assertions(1);

		const result = parseBadgeResponse({
			body: JSON.parse("null"),
			headers: {},
			status: 500,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it.for([
		{ awarderBody: "42", label: "awarder is not an object" },
		{
			awarderBody: '{ "id": "222", "name": "Lobby", "type": 1 }',
			label: "awarder.id has the wrong type",
		},
		{
			awarderBody: '{ "id": 222, "name": 42, "type": 1 }',
			label: "awarder.name has the wrong type",
		},
		{
			awarderBody: '{ "id": 222, "name": "Lobby", "type": 2 }',
			label: "awarder.type is not the Place enum value",
		},
	])("should return an ApiError when $label", ({ awarderBody }) => {
		expect.assertions(1);

		const body = JSON.parse(
			`{
				"awarder": ${awarderBody},
				"created": "2024-01-15T10:30:00.000Z",
				"description": "malformed awarder",
				"displayDescription": "malformed awarder",
				"displayIconImageId": 0,
				"displayName": "malformed awarder",
				"enabled": true,
				"iconImageId": 0,
				"id": 1,
				"name": "Malformed",
				"statistics": { "awardedCount": 0, "pastDayAwardedCount": 0, "winRatePercentage": 0 },
				"updated": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseBadgeResponse({ body, headers: {}, status: 422 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it.for([
		{ label: "statistics is not an object", statisticsBody: "42" },
		{
			label: "awardedCount has the wrong type",
			statisticsBody:
				'{ "awardedCount": "0", "pastDayAwardedCount": 0, "winRatePercentage": 0 }',
		},
		{
			label: "pastDayAwardedCount has the wrong type",
			statisticsBody:
				'{ "awardedCount": 0, "pastDayAwardedCount": "0", "winRatePercentage": 0 }',
		},
		{
			label: "winRatePercentage has the wrong type",
			statisticsBody:
				'{ "awardedCount": 0, "pastDayAwardedCount": 0, "winRatePercentage": "0" }',
		},
	])("should return an ApiError when $label", ({ statisticsBody }) => {
		expect.assertions(1);

		const body = JSON.parse(
			`{
				"awarder": { "id": 222, "name": "Lobby", "type": 1 },
				"created": "2024-01-15T10:30:00.000Z",
				"description": "malformed stats",
				"displayDescription": "malformed stats",
				"displayIconImageId": 0,
				"displayName": "malformed stats",
				"enabled": true,
				"iconImageId": 0,
				"id": 1,
				"name": "Malformed",
				"statistics": ${statisticsBody},
				"updated": "2024-03-20T14:45:00.000Z"
			}`,
		);

		const result = parseBadgeResponse({ body, headers: {}, status: 422 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it.for([
		{ field: "created" as const },
		{ field: "updated" as const },
	])(
		"should return an ApiError when $field is a string that does not parse to a Date",
		({ field }) => {
			expect.assertions(2);

			const body = validBadgeBody({ [field]: "not-a-date" });

			const result = parseBadgeResponse({ body, headers: {}, status: 502 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed badge response");
		},
	);

	it("should reject an awarder that is an array with look-alike named properties", () => {
		expect.assertions(1);

		const awarder = Object.assign([], { id: 222, name: "Lobby", type: 1 });
		const body = { ...validBadgeBody(), awarder };

		const result = parseBadgeResponse({ body, headers: {}, status: 500 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should reject statistics that is an array with look-alike named properties", () => {
		expect.assertions(1);

		const statistics = Object.assign([], {
			awardedCount: 0,
			pastDayAwardedCount: 0,
			winRatePercentage: 0,
		});
		const body = { ...validBadgeBody(), statistics };

		const result = parseBadgeResponse({ body, headers: {}, status: 500 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});
});
