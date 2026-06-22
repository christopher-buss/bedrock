import { gamePassCurrent, placeCurrent, placeDesired } from "#tests/helpers/resources";
import { describe, expect, it } from "vitest";

import { asResourceKey } from "../types/ids.ts";
import { buildRepublishOps } from "./build-republish-ops.ts";

describe(buildRepublishOps, () => {
	it("should emit an update op carrying the rebuild marker for a place already in current state", () => {
		expect.assertions(1);

		const desired = placeDesired();
		const current = placeCurrent();

		const ops = buildRepublishOps({
			currentResources: [current],
			desiredPlaces: [desired],
			keys: [desired.key],
		});

		expect(ops).toStrictEqual([
			{ key: desired.key, changedFields: ["rebuild"], current, desired, type: "update" },
		]);
	});

	it("should emit a create op for a place absent from current state", () => {
		expect.assertions(1);

		const desired = placeDesired();

		const ops = buildRepublishOps({
			currentResources: [],
			desiredPlaces: [desired],
			keys: [desired.key],
		});

		expect(ops).toStrictEqual([{ key: desired.key, desired, type: "create" }]);
	});

	it("should match current state by the place kind, not by key alone", () => {
		expect.assertions(1);

		const desired = placeDesired({ key: asResourceKey("shared") });
		// A game pass keyed the same string must not be mistaken for the place's
		// current state.
		const collidingPass = gamePassCurrent({ key: asResourceKey("shared") });

		const ops = buildRepublishOps({
			currentResources: [collidingPass],
			desiredPlaces: [desired],
			keys: [desired.key],
		});

		expect(ops).toStrictEqual([{ key: desired.key, desired, type: "create" }]);
	});

	it("should not match a place current whose key differs from the declared place", () => {
		expect.assertions(1);

		const desired = placeDesired({ key: asResourceKey("wanted-place") });
		// A different place in current state must not satisfy the matching place;
		// the absent match means a create, not an update.
		const otherPlace = placeCurrent({ key: asResourceKey("other-place") });

		const ops = buildRepublishOps({
			currentResources: [otherPlace],
			desiredPlaces: [desired],
			keys: [desired.key],
		});

		expect(ops).toStrictEqual([{ key: desired.key, desired, type: "create" }]);
	});

	it("should republish only the places named in keys", () => {
		expect.assertions(1);

		const lobby = placeDesired({ key: asResourceKey("lobby") });
		const arena = placeDesired({ key: asResourceKey("arena") });

		const ops = buildRepublishOps({
			currentResources: [],
			desiredPlaces: [lobby, arena],
			keys: [arena.key],
		});

		expect(ops).toStrictEqual([{ key: arena.key, desired: arena, type: "create" }]);
	});
});
