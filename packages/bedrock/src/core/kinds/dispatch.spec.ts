import { describe, it } from "vitest";

import {
	badgeDesired,
	developerProductCurrent,
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
	placeCurrent,
	placeDesired,
	universeCurrent,
	universeDesired,
} from "#tests/helpers/resources";
import { changedFieldsBetween } from "./dispatch.ts";

// `diff` pairs the two sides on a composite key that already carries the
// kind, so only a direct call can put mismatched kinds in front of this
// dispatcher.
const MISMATCHED = [
	["badge", badgeDesired(), gamePassCurrent()],
	["developerProduct", developerProductDesired(), gamePassCurrent()],
	["gamePass", gamePassDesired(), placeCurrent()],
	["place", placeDesired(), universeCurrent()],
	["universe", universeDesired(), developerProductCurrent()],
] as const;

describe(changedFieldsBetween, () => {
	it.for(MISMATCHED)(
		"should report no changed fields when a %s desired state is paired with another kind",
		([, desired, current], { expect }) => {
			expect.assertions(1);

			expect(changedFieldsBetween(desired, current)).toBeEmpty();
		},
	);

	it("should delegate to the kind module when both sides share a kind", ({ expect }) => {
		expect.assertions(1);

		expect(
			changedFieldsBetween(gamePassDesired({ name: "Renamed Pass" }), gamePassCurrent()),
		).toStrictEqual(["name"]);
	});
});
