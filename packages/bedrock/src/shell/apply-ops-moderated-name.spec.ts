import { describe, it } from "vitest";

import { BADGE_TRAP } from "#tests/helpers/drivers";
import {
	developerProductCurrent,
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
} from "#tests/helpers/resources";
import type { CreateOperation, UpdateOperation } from "../core/operations.ts";
import type { ProgressEvent } from "../ports/progress-port.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import { asResourceKey } from "../types/ids.ts";
import { applyOps } from "./apply-ops.ts";

const FILTERED = "##############";
const GEM_KEY = asResourceKey("gem-pack");

function trap(): never {
	throw new Error("Unexpected driver call");
}

const filteringProducts: ResourceDriver<"developerProduct"> = {
	async create(desired) {
		return { data: developerProductCurrent({ ...desired, name: FILTERED }), success: true };
	},
	retire: trap,
	async update(current, desired) {
		return {
			data: { ...desired, name: FILTERED, outputs: current.outputs },
			success: true,
		};
	},
};

const REGISTRY: DriverRegistry = {
	badge: BADGE_TRAP,
	developerProduct: filteringProducts,
	gamePass: {
		async create(desired) {
			return { data: gamePassCurrent({ ...desired }), success: true };
		},
		retire: trap,
	},
	place: { create: trap, retire: trap },
	universe: { create: trap, retire: trap },
};

const CREATE_GEM = {
	key: GEM_KEY,
	desired: developerProductDesired({ name: "Gem Pack 12345" }),
	type: "create",
} as const satisfies CreateOperation;

describe("applyOps moderated developer product names", () => {
	it("should keep a filtered create in applied and report moderatedName", async ({ expect }) => {
		expect.assertions(1);

		const pass = gamePassDesired();
		const result = await applyOps(
			[CREATE_GEM, { key: pass.key, desired: pass, type: "create" }],
			REGISTRY,
		);

		expect(result).toStrictEqual({
			err: {
				applied: [
					developerProductCurrent({ ...CREATE_GEM.desired, name: FILTERED }),
					gamePassCurrent({ ...pass }),
				],
				failures: [
					{
						key: GEM_KEY,
						kind: "moderatedName",
						stored: FILTERED,
						submitted: "Gem Pack 12345",
					},
				],
			},
			success: false,
		});
	});

	it("should report a filtered update as a failed op carrying moderatedName", async ({
		expect,
	}) => {
		expect.assertions(2);

		const desired = developerProductDesired({ name: "Gem Pack 12345" });
		const op = {
			key: GEM_KEY,
			changedFields: ["name"],
			current: developerProductCurrent(),
			desired,
			type: "update",
		} as const satisfies UpdateOperation;
		const events: Array<ProgressEvent> = [];

		const result = await applyOps([op], REGISTRY, {
			environment: "production",
			progress: {
				emit(event) {
					events.push(event);
				},
			},
		});

		expect(result).toMatchObject({
			err: { applied: [{ key: GEM_KEY, name: FILTERED }] },
			success: false,
		});
		expect(events).toContainEqual(
			expect.objectContaining({
				error: {
					key: GEM_KEY,
					kind: "moderatedName",
					stored: FILTERED,
					submitted: "Gem Pack 12345",
				},
				kind: "resourceOpFailed",
				opType: "update",
			}),
		);
	});
});
