import { describe, it } from "vitest";

import { badgeDesired, gamePassDesired } from "#tests/helpers/resources";
import { asResourceKey } from "../types/ids.ts";
import { badgeCreatesIn, checkBadgeCapacity, nextFreeBadgeQuotaReset } from "./capacity-check.ts";
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
