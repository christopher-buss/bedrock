import {
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
	placeDesired,
	universeDesired,
} from "#tests/helpers/resources";
import { describe, expect, it } from "vitest";

import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import type { Operation } from "./operations.ts";
import { planTwoPhase } from "./plan-two-phase.ts";

const NO_MARKER: ReadonlySet<ResourceKey> = new Set();

function gamePassCreate(): Operation {
	const desired = gamePassDesired();
	return { key: desired.key, desired, type: "create" };
}

function developerProductCreate(): Operation {
	const desired = developerProductDesired();
	return { key: desired.key, desired, type: "create" };
}

function placeCreate(): Operation {
	const desired = placeDesired();
	return { key: desired.key, desired, type: "create" };
}

function universeCreate(): Operation {
	const desired = universeDesired();
	return { key: desired.key, desired, type: "create" };
}

function gamePassUpdate(): Operation {
	const current = gamePassCurrent();
	const desired = gamePassDesired({ name: "VIP Pass (renamed)" });
	return { key: desired.key, changedFields: ["name"], current, desired, type: "update" };
}

function placeNoopFor(key: ResourceKey): Operation {
	return { key, kind: "place", type: "noop" };
}

function placeNoop(): Operation {
	return placeNoopFor(placeDesired().key);
}

function gamePassNoop(): Operation {
	return { key: asResourceKey("legend-pass"), kind: "gamePass", type: "noop" };
}

describe(planTwoPhase, () => {
	it("should not activate when no provisioned create or marker exists", () => {
		expect.assertions(2);

		const ops = [gamePassUpdate(), placeCreate()];

		const plan = planTwoPhase(ops, NO_MARKER);

		expect(plan.activates).toBeFalse();
		expect(plan.assetOps).toStrictEqual(ops);
	});

	it("should activate on a game-pass create", () => {
		expect.assertions(1);

		expect(planTwoPhase([gamePassCreate()], NO_MARKER).activates).toBeTrue();
	});

	it("should activate on a developer-product create", () => {
		expect.assertions(1);

		expect(planTwoPhase([developerProductCreate()], NO_MARKER).activates).toBeTrue();
	});

	it("should not treat a place create as a provisioned create", () => {
		expect.assertions(1);

		expect(planTwoPhase([placeCreate()], NO_MARKER).activates).toBeFalse();
	});

	it("should not treat a universe create as a provisioned create", () => {
		expect.assertions(1);

		expect(planTwoPhase([universeCreate()], NO_MARKER).activates).toBeFalse();
	});

	it("should activate from a pending-rebuild marker even without a provisioned create", () => {
		expect.assertions(2);

		const marker = new Set([placeDesired().key]);

		const plan = planTwoPhase([placeNoop()], marker);

		expect(plan.activates).toBeTrue();
		expect(plan.assetOps).toStrictEqual([]);
	});

	it("should withhold place ops from the asset stage when two-phase activates", () => {
		expect.assertions(2);

		const pass = gamePassCreate();
		const universe = universeCreate();
		const place = placeCreate();

		const plan = planTwoPhase([pass, place, universe], NO_MARKER);

		expect(plan.activates).toBeTrue();
		expect(plan.assetOps).toStrictEqual([pass, universe]);
	});

	it("should withhold a noop place from the asset stage when two-phase activates", () => {
		expect.assertions(1);

		const pass = gamePassCreate();

		const plan = planTwoPhase([pass, placeNoop()], NO_MARKER);

		expect(plan.assetOps).toStrictEqual([pass]);
	});

	it("should keep a non-place noop in the asset stage when two-phase activates", () => {
		expect.assertions(1);

		const pass = gamePassCreate();
		const noop = gamePassNoop();

		const plan = planTwoPhase([pass, noop], NO_MARKER);

		expect(plan.assetOps).toStrictEqual([pass, noop]);
	});

	it("should mark every declared place when a provisioned create is present", () => {
		expect.assertions(1);

		const arena = asResourceKey("arena");
		const lobby = asResourceKey("lobby");
		const plan = planTwoPhase(
			[gamePassCreate(), placeNoopFor(lobby), placeNoopFor(arena)],
			NO_MARKER,
		);

		expect(plan.markPlaces).toStrictEqual([lobby, arena]);
	});

	it("should mark every declared place on a marker-driven activation, not just the marked one", () => {
		expect.assertions(1);

		const arena = asResourceKey("arena");
		const lobby = asResourceKey("lobby");
		const plan = planTwoPhase([placeNoopFor(lobby), placeNoopFor(arena)], new Set([arena]));

		expect(plan.markPlaces).toStrictEqual([lobby, arena]);
	});

	it("should leave markPlaces empty when two-phase does not activate", () => {
		expect.assertions(1);

		expect(planTwoPhase([gamePassUpdate()], NO_MARKER).markPlaces).toStrictEqual([]);
	});
});
