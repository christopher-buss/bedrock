// Captured 2026-11-09 with unauthenticated GETs against badges.roblox.com for
// a public universe. Badge, icon, universe and place IDs, names and
// descriptions are scrubbed to stable fakes; see tests/fixtures/badges/*.md.
import { assert, describe, it } from "vitest";

import { UnexpectedResponseError } from "#src/errors/unexpected-response";
import { loadFixture } from "#tests/conformance/_helpers";
import { validBadgeDetailsBody } from "#tests/helpers/badges";
import { parseBadgeDetailsResponse, parseBadgesListResponse } from "./parsers.ts";

function without(key: string): Record<string, unknown> {
	const body: Record<string, unknown> = { ...validBadgeDetailsBody() };
	delete body[key];
	return body;
}

describe(parseBadgeDetailsResponse, () => {
	it("should parse a captured badge read", ({ expect }) => {
		expect.assertions(1);

		const result = parseBadgeDetailsResponse({
			body: loadFixture("badges", "get-response.json"),
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "1001",
			name: "Test badge 1",
			awardingUniverse: { id: "123", name: "Test universe", rootPlaceId: "456" },
			createdAt: new Date("2018-10-17T12:43:51.290Z"),
			description: "Test badge 1 description",
			displayDescription: "Test badge 1 description",
			displayIconImageId: "5001",
			displayName: "Test badge 1",
			enabled: true,
			iconImageId: "5001",
			statistics: { awardedCount: 1_564_002, pastDayAwardedCount: 96, winRatePercentage: 0 },
			updatedAt: new Date("2018-10-17T12:43:51.290Z"),
		});
	});

	it("should map a zero icon ID to undefined", ({ expect }) => {
		expect.assertions(2);

		const result = parseBadgeDetailsResponse({
			body: validBadgeDetailsBody({ displayIconImageId: 0, iconImageId: 0 }),
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data.iconImageId).toBeUndefined();
		expect(result.data.displayIconImageId).toBeUndefined();
	});

	it.for([
		["a non-object body", []],
		["a missing name", without("name")],
		["a bad statistics block", { ...validBadgeDetailsBody(), statistics: {} }],
		["a missing awarding universe", without("awardingUniverse")],
		["a non-object awarding universe", { ...validBadgeDetailsBody(), awardingUniverse: 1 }],
		[
			"a non-numeric universe ID",
			{
				...validBadgeDetailsBody(),
				awardingUniverse: { id: "1", name: "U", rootPlaceId: 2 },
			},
		],
		[
			"a non-string universe name",
			{ ...validBadgeDetailsBody(), awardingUniverse: { id: 1, name: 3, rootPlaceId: 2 } },
		],
		[
			"a non-numeric root place ID",
			{
				...validBadgeDetailsBody(),
				awardingUniverse: { id: 1, name: "U", rootPlaceId: "2" },
			},
		],
	] as const)("should reject %s", ([, body], { expect }) => {
		expect.assertions(4);

		const result = parseBadgeDetailsResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed badge response");
		expect(result.err.statusCode).toBe(200);
		expect(result.err.details).toStrictEqual(body);
	});
});

describe(parseBadgesListResponse, () => {
	it("should parse a captured first page and keep its cursor", ({ expect }) => {
		expect.assertions(3);

		const result = parseBadgesListResponse({
			body: loadFixture("badges", "list-page-1-response.json"),
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data.items).toHaveLength(7);
		expect(result.data.items[6]).toMatchObject({
			id: "1007",
			name: "Test badge 7",
			awardingUniverse: { id: "123" },
		});
		expect(result.data.nextPageToken).toBe("test-cursor-page-2");
	});

	it("should parse a captured empty last page with a null cursor", ({ expect }) => {
		expect.assertions(1);

		expect(
			parseBadgesListResponse({
				body: loadFixture("badges", "list-page-2-response.json"),
				headers: {},
				status: 200,
			}),
		).toStrictEqual({ data: { items: [], nextPageToken: undefined }, success: true });
	});

	it("should treat an absent cursor as the last page", ({ expect }) => {
		expect.assertions(1);

		const result = parseBadgesListResponse({
			body: { data: [validBadgeDetailsBody()] },
			headers: {},
			status: 200,
		});
		assert(result.success);

		expect(result.data.nextPageToken).toBeUndefined();
	});

	it.for([
		["a non-object body", []],
		["a missing data array", {}],
		["a non-array data field", { data: {} }],
		["a malformed badge", { data: [{}] }],
		["a non-string cursor", { data: [], nextPageCursor: 123 }],
	] as const)("should reject %s", ([, body], { expect }) => {
		expect.assertions(4);

		const result = parseBadgesListResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed badges list response");
		expect(result.err.statusCode).toBe(200);
		expect(result.err.details).toStrictEqual(body);
	});
});
