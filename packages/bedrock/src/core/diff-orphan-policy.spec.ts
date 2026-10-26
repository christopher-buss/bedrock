import { asResourceKey, diff } from "@bedrock-rbx/core";

import { describe, it } from "vitest";

import {
	developerProductCurrent,
	gamePassCurrent,
	gamePassDesired,
	placeCurrent,
	placeDesired,
	universeCurrent,
	universeDesired,
} from "#tests/helpers/resources";

describe("diff orphan policy", () => {
	it("should preserve an implicit root-place rename before considering automatic retirement", ({
		expect,
	}) => {
		expect.assertions(1);

		const place = placeCurrent();
		const key = asResourceKey("new-root");

		expect(
			diff(
				[universeDesired(), placeDesired({ key })],
				[universeCurrent({ outputs: { rootPlaceId: place.placeId } }), place],
				{ orphans: "retire" },
			),
		).toStrictEqual([
			{ key: "main", kind: "universe", type: "noop" },
			{ key, kind: "place", type: "noop" },
		]);
	});

	it("should emit current-bearing retirement operations for every unmarked orphan", ({
		expect,
	}) => {
		expect.assertions(1);

		const current = [gamePassCurrent(), developerProductCurrent(), placeCurrent()];

		expect(diff([], current, { orphans: "retire" })).toStrictEqual(
			current.map((entry) => {
				return { key: entry.key, current: entry, type: "retire" };
			}),
		);
	});

	it("should refuse a known root orphan before returning any operations", ({ expect }) => {
		expect.assertions(1);

		const place = placeCurrent();

		expect(() => {
			return diff(
				[universeDesired(), gamePassDesired()],
				[universeCurrent({ outputs: { rootPlaceId: place.placeId } }), place],
				{ orphans: "retire" },
			);
		}).toThrow("Cannot retire root place");
	});

	it("should resolve explicit and implicit renames before choosing orphan retirements", ({
		expect,
	}) => {
		expect.assertions(1);

		const key = asResourceKey("renamed");

		expect(
			diff(
				[gamePassDesired({ key, movedFrom: "vip-pass" }), placeDesired({ key })],
				[gamePassCurrent(), placeCurrent()],
				{ orphans: "retire" },
			),
		).toStrictEqual([
			{ key, kind: "gamePass", type: "noop" },
			{ key, kind: "place", type: "noop" },
		]);
	});

	it.for([{}, { orphans: "error" }] as const)(
		"should retain throwing refusal for default policy %s",
		(options, { expect }) => {
			expect.assertions(1);
			expect(() => diff([], [gamePassCurrent()], options)).toThrow("Unresolved orphans");
		},
	);

	it("should refuse universe absence even with a matching bare key under retire", ({
		expect,
	}) => {
		expect.assertions(1);
		expect(() => {
			return diff([gamePassDesired({ key: asResourceKey("main") })], [universeCurrent()], {
				orphans: "retire",
			});
		}).toThrow("Universe removal is not available at this time.");
	});

	it("should preserve explicit untrack and avoid retirement when there is no state", ({
		expect,
	}) => {
		expect.assertions(2);

		const current = gamePassCurrent();

		expect(
			diff([{ key: current.key, kind: "gamePass", retired: "untrack" }], [current], {
				orphans: "retire",
			}),
		).toStrictEqual([{ key: current.key, current, type: "untrack" }]);
		expect(diff([], [], { orphans: "retire" })).toStrictEqual([]);
	});
});
