import {
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
	placeDesired,
} from "#tests/helpers/resources";
import { describe, expect, it } from "vitest";

import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import type { Operation } from "./operations.ts";
import { planTwoPhase } from "./plan-two-phase.ts";

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
	it("should withhold place ops from the asset stage", () => {
		expect.assertions(2);

		const pass = gamePassCreate();
		const product = developerProductCreate();
		const place = placeCreate();

		const plan = planTwoPhase([pass, place, product]);

		expect(plan.assetOps).toStrictEqual([pass, product]);
		expect(plan.placeOps).toStrictEqual([place]);
	});

	it("should withhold a noop place from the asset stage", () => {
		expect.assertions(2);

		const pass = gamePassCreate();
		const place = placeNoop();

		const plan = planTwoPhase([pass, place]);

		expect(plan.assetOps).toStrictEqual([pass]);
		expect(plan.placeOps).toStrictEqual([place]);
	});

	it("should keep a non-place noop in the asset stage", () => {
		expect.assertions(1);

		const pass = gamePassCreate();
		const noop = gamePassNoop();

		const plan = planTwoPhase([pass, noop]);

		expect(plan.assetOps).toStrictEqual([pass, noop]);
	});

	it("should mark every declared place regardless of its op type", () => {
		expect.assertions(1);

		const arena = asResourceKey("arena");
		const lobby = asResourceKey("lobby");

		const plan = planTwoPhase([gamePassCreate(), placeNoopFor(lobby), placeNoopFor(arena)]);

		expect(plan.markPlaces).toStrictEqual([lobby, arena]);
	});

	it("should leave markPlaces and placeOps empty when no place op exists", () => {
		expect.assertions(2);

		const plan = planTwoPhase([gamePassUpdate()]);

		expect(plan.markPlaces).toStrictEqual([]);
		expect(plan.placeOps).toStrictEqual([]);
	});
});
