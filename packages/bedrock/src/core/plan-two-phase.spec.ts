import {
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
	placeDesired,
	universeDesired,
} from "#tests/helpers/resources";
import { describe, expect, it } from "vitest";

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

function universeCreate(): Operation {
	const desired = universeDesired();
	return { key: desired.key, desired, type: "create" };
}

function gamePassUpdate(): Operation {
	const current = gamePassCurrent();
	const desired = gamePassDesired({ name: "VIP Pass (renamed)" });
	return { key: desired.key, changedFields: ["name"], current, desired, type: "update" };
}

function placeNoop(): Operation {
	return { key: placeDesired().key, kind: "place", type: "noop" };
}

describe(planTwoPhase, () => {
	it("should not activate when no rebuild hook is supplied", () => {
		expect.assertions(2);

		const ops = [gamePassCreate(), placeCreate()];

		const plan = planTwoPhase(ops, false);

		expect(plan.activates).toBeFalse();
		expect(plan.assetOps).toStrictEqual(ops);
	});

	it("should not activate when the hook is supplied but no provisioned create exists", () => {
		expect.assertions(2);

		const ops = [gamePassUpdate(), placeCreate()];

		const plan = planTwoPhase(ops, true);

		expect(plan.activates).toBeFalse();
		expect(plan.assetOps).toStrictEqual(ops);
	});

	it("should activate on a game-pass create when the hook is supplied", () => {
		expect.assertions(1);

		expect(planTwoPhase([gamePassCreate()], true).activates).toBeTrue();
	});

	it("should activate on a developer-product create when the hook is supplied", () => {
		expect.assertions(1);

		expect(planTwoPhase([developerProductCreate()], true).activates).toBeTrue();
	});

	it("should not treat a place create as a provisioned create", () => {
		expect.assertions(1);

		expect(planTwoPhase([placeCreate()], true).activates).toBeFalse();
	});

	it("should not treat a universe create as a provisioned create", () => {
		expect.assertions(1);

		expect(planTwoPhase([universeCreate()], true).activates).toBeFalse();
	});

	it("should withhold place ops from the asset stage when two-phase activates", () => {
		expect.assertions(2);

		const pass = gamePassCreate();
		const universe = universeCreate();
		const place = placeCreate();

		const plan = planTwoPhase([pass, place, universe], true);

		expect(plan.activates).toBeTrue();
		expect(plan.assetOps).toStrictEqual([pass, universe]);
	});

	it("should withhold a noop place from the asset stage when two-phase activates", () => {
		expect.assertions(1);

		const pass = gamePassCreate();

		const plan = planTwoPhase([pass, placeNoop()], true);

		expect(plan.assetOps).toStrictEqual([pass]);
	});
});
