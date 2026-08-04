import { describe, expect, it } from "vitest";

import {
	developerProductCurrent,
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
	placeCurrent,
	placeDesired,
	universeCurrent,
	universeDesired,
} from "#tests/helpers/resources";
import { assertReconcilable, changedFieldsBetween } from "./dispatch.ts";

// `diff` and `assertAllReconcilable` pair the two sides on a composite key
// that already carries the kind, so only a direct call can put mismatched
// kinds in front of these dispatchers.
const MISMATCHED = [
	["developerProduct", developerProductDesired(), gamePassCurrent()],
	["gamePass", gamePassDesired(), placeCurrent()],
	["place", placeDesired(), universeCurrent()],
	["universe", universeDesired(), developerProductCurrent()],
] as const;

describe(changedFieldsBetween, () => {
	it.for(MISMATCHED)(
		"should report no changed fields when a %s desired state is paired with another kind",
		([, desired, current]) => {
			expect.assertions(1);

			expect(changedFieldsBetween(desired, current)).toBeEmpty();
		},
	);

	it("should delegate to the kind module when both sides share a kind", () => {
		expect.assertions(1);

		expect(
			changedFieldsBetween(gamePassDesired({ name: "Renamed Pass" }), gamePassCurrent()),
		).toStrictEqual(["name"]);
	});
});

describe(assertReconcilable, () => {
	it.for(MISMATCHED)(
		"should decline to judge a %s desired state paired with another kind",
		([, desired, current]) => {
			expect.assertions(1);

			expect(assertReconcilable(desired, current)).toBeUndefined();
		},
	);

	it("should delegate to the kind module when both sides share a kind", () => {
		expect.assertions(1);

		expect(assertReconcilable(gamePassDesired(), gamePassCurrent())).toBeUndefined();
	});
});
