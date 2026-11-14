import { describe, it } from "vitest";

import { badgeDesired, gamePassDesired } from "#tests/helpers/resources";
import { asResourceKey } from "../types/ids.ts";
import {
	badgeCreatesIn,
	checkBadgeCapacity,
	needsCreationPrice,
	nextFreeBadgeQuotaReset,
	spendLimitOf,
} from "./capacity-check.ts";
import type { CreateOperation } from "./operations.ts";

function badgeCreate(key: string): CreateOperation {
	return {
		key: asResourceKey(key),
		desired: badgeDesired({ key: asResourceKey(key) }),
		type: "create",
	};
}

describe(badgeCreatesIn, () => {
	it("should keep only badge creates", ({ expect }) => {
		expect.assertions(1);

		const create = badgeCreate("first-win");

		expect(
			badgeCreatesIn([
				create,
				{ key: asResourceKey("vip"), desired: gamePassDesired(), type: "create" },
				{ key: asResourceKey("first-win"), kind: "badge", type: "noop" },
			]),
		).toStrictEqual([create]);
	});
});

describe(checkBadgeCapacity, () => {
	const creates = ["c-badge", "a-badge", "b-badge"].map(badgeCreate);

	it("should defer the creates beyond the quota in key order when deferral is allowed", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(checkBadgeCapacity({ allowDeferredCreates: true, creates, quota: 1 })).toStrictEqual(
			{
				deferred: [badgeCreate("b-badge"), badgeCreate("c-badge")],
				kind: "defer",
			},
		);
	});

	it("should run the creates serially with an unknown quota when deferral is allowed", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(
			checkBadgeCapacity({ allowDeferredCreates: true, creates, quota: undefined }),
		).toStrictEqual({ kind: "serial" });
	});

	it("should proceed without deferring when the quota covers every create", ({ expect }) => {
		expect.assertions(1);

		expect(checkBadgeCapacity({ allowDeferredCreates: true, creates, quota: 3 })).toStrictEqual(
			{
				kind: "proceed",
			},
		);
	});

	it.for([200, 250])(
		"should pay for the shortfall when it fits a spend limit of %i",
		(spendLimit, { expect }) => {
			expect.assertions(1);

			expect(
				checkBadgeCapacity({
					allowDeferredCreates: false,
					creates,
					price: 100,
					quota: 1,
					spendLimit,
				}),
			).toStrictEqual({ kind: "pay", paid: 2, price: 100 });
		},
	);

	it("should refuse with the Robux needed when the shortfall exceeds the spend limit", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(
			checkBadgeCapacity({
				allowDeferredCreates: false,
				creates,
				price: 100,
				quota: 1,
				spendLimit: 199,
			}),
		).toStrictEqual({
			available: 1,
			kind: "refuse",
			needed: 3,
			spend: { limit: 199, needed: 200, price: 100 },
		});
	});

	it("should refuse without a spend shortfall when the price is unknown", ({ expect }) => {
		expect.assertions(1);

		expect(
			checkBadgeCapacity({
				allowDeferredCreates: false,
				creates,
				price: undefined,
				quota: 1,
				spendLimit: 1000,
			}),
		).toStrictEqual({ available: 1, kind: "refuse", needed: 3 });
	});

	it("should treat a spend limit of 0 as no limit", ({ expect }) => {
		expect.assertions(1);

		expect(
			checkBadgeCapacity({
				allowDeferredCreates: false,
				creates,
				price: 100,
				quota: 1,
				spendLimit: 0,
			}),
		).toStrictEqual({ available: 1, kind: "refuse", needed: 3 });
	});
});

describe(needsCreationPrice, () => {
	const creates = ["a-badge", "b-badge"].map(badgeCreate);

	it("should need the price when spending could cover a known shortfall", ({ expect }) => {
		expect.assertions(1);

		expect(
			needsCreationPrice({ allowDeferredCreates: false, creates, quota: 1, spendLimit: 100 }),
		).toBeTrue();
	});

	it.for([
		{ allowDeferredCreates: false, quota: 2, spendLimit: 100 },
		{ allowDeferredCreates: false, quota: undefined, spendLimit: 100 },
		{ allowDeferredCreates: false, quota: 1, spendLimit: 0 },
		{ allowDeferredCreates: true, quota: 1, spendLimit: 100 },
	])("should not need the price for %o", (inputs, { expect }) => {
		expect.assertions(1);

		expect(needsCreationPrice({ ...inputs, creates })).toBeFalse();
	});
});

describe(spendLimitOf, () => {
	const environments = { dev: {}, production: { spendLimit: 500 } };

	it("should use the Environment's spend limit with spend approval", ({ expect }) => {
		expect.assertions(1);

		expect(spendLimitOf(environments.production, true)).toBe(500);
	});

	it.for([
		["production", false],
		["dev", true],
	] as const)(
		"should spend nothing in %s with approval %s",
		([environment, allowSpend], { expect }) => {
			expect.assertions(1);

			expect(spendLimitOf(environments[environment], allowSpend)).toBe(0);
		},
	);
});

describe(nextFreeBadgeQuotaReset, () => {
	it.for([
		["2026-10-27T00:00:00.000Z", "2026-10-28T00:00:00.000Z"],
		["2026-12-31T23:59:59.999Z", "2027-01-01T00:00:00.000Z"],
	])("should reset %s at %s", ([now, reset], { expect }) => {
		expect.assertions(1);

		expect(nextFreeBadgeQuotaReset(new Date(now!)).toISOString()).toBe(reset);
	});
});
