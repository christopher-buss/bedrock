import { OpenCloudError } from "@bedrock-rbx/ocale";

import {
	developerProductCurrent,
	gamePassCurrent,
	gamePassDesired,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";
import { describe, expect, it } from "vitest";

import type { Operation } from "../core/operations.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { ProgressEvent, ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import { applyAndPersist } from "./reconcile-pass.ts";

const alpha = gamePassCurrent({
	key: asResourceKey("alpha-pass"),
	name: "Alpha Pass",
});
const vip = gamePassCurrent({ key: asResourceKey("vip-pass") });

function createGamePassOp(key: ResourceKey): Operation {
	return { key, desired: gamePassDesired({ key }), type: "create" };
}

const developerProductStub: ResourceDriver<"developerProduct"> = {
	async create() {
		throw new Error("developerProduct driver must not run for this fixture");
	},
};

const placeStub: ResourceDriver<"place"> = {
	async create() {
		throw new Error("place driver must not run for this fixture");
	},
};

const universeStub: ResourceDriver<"universe"> = {
	async create() {
		throw new Error("universe driver must not run for this fixture");
	},
};

function gamePassRegistry(byKey: Record<string, ResourceCurrentState<"gamePass">>): DriverRegistry {
	return {
		developerProduct: developerProductStub,
		gamePass: {
			async create(desired) {
				const current = byKey[desired.key];
				if (current === undefined) {
					throw new Error(`no fixture for ${desired.key}`);
				}

				return { data: current, success: true };
			},
		},
		place: placeStub,
		universe: universeStub,
	};
}

function recordingProgress(): { calls: Array<ProgressEvent>; port: ProgressPort } {
	const calls: Array<ProgressEvent> = [];
	return {
		calls,
		port: {
			emit(event) {
				calls.push(event);
			},
		},
	};
}

function inMemoryStatePort(): {
	port: StatePort;
	writes: Array<ReadonlyArray<ResourceCurrentState>>;
} {
	const writes: Array<ReadonlyArray<ResourceCurrentState>> = [];
	return {
		port: {
			async read() {
				return { data: undefined, success: true };
			},
			async write(state) {
				writes.push(state.resources);
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

describe(applyAndPersist, () => {
	it("should persist a partial snapshot then a cumulative snapshot across two passes", async () => {
		expect.assertions(4);

		const { port, writes } = inMemoryStatePort();
		const registry = gamePassRegistry({ "alpha-pass": alpha, "vip-pass": vip });
		const { calls, port: progress } = recordingProgress();

		const first = await applyAndPersist({
			environment: "production",
			ops: [createGamePassOp(asResourceKey("alpha-pass"))],
			priorResources: [],
			progress,
			registry,
			statePort: port,
		});

		const second = await applyAndPersist({
			environment: "production",
			ops: [createGamePassOp(asResourceKey("vip-pass"))],
			priorResources: first.merged.resources,
			progress,
			registry,
			statePort: port,
		});

		expect(writes[0]).toStrictEqual([alpha]);
		expect(writes[1]).toStrictEqual([alpha, vip]);
		expect(second.merged.resources).toStrictEqual([alpha, vip]);
		expect(calls.filter((event) => event.kind === "stateWritten")).toHaveLength(2);
	});

	it("should keep prior outputs of other kinds untouched while a pass updates one resource", async () => {
		expect.assertions(1);

		const priorProduct = developerProductCurrent();
		const priorPlace = placeCurrent();
		const priorUniverse = universeCurrent();
		const { port, writes } = inMemoryStatePort();
		const registry = gamePassRegistry({ "vip-pass": vip });
		const { port: progress } = recordingProgress();

		await applyAndPersist({
			environment: "production",
			ops: [createGamePassOp(asResourceKey("vip-pass"))],
			priorResources: [priorProduct, priorPlace, priorUniverse],
			progress,
			registry,
			statePort: port,
		});

		expect(writes[0]).toStrictEqual([priorProduct, priorPlace, priorUniverse, vip]);
	});

	it("should carry the cumulative snapshot in the failing write of a later pass", async () => {
		expect.assertions(2);

		const stateError = { file: "state.json", kind: "stateError" as const, reason: "EACCES" };
		let writeCount = 0;
		const port: StatePort = {
			async read() {
				return { data: undefined, success: true };
			},
			async write() {
				writeCount += 1;
				return writeCount === 1
					? { data: undefined, success: true }
					: { err: stateError, success: false };
			},
		};
		const registry = gamePassRegistry({ "alpha-pass": alpha, "vip-pass": vip });
		const { port: progress } = recordingProgress();

		const first = await applyAndPersist({
			environment: "production",
			ops: [createGamePassOp(asResourceKey("alpha-pass"))],
			priorResources: [],
			progress,
			registry,
			statePort: port,
		});

		const second = await applyAndPersist({
			environment: "production",
			ops: [createGamePassOp(asResourceKey("vip-pass"))],
			priorResources: first.merged.resources,
			progress,
			registry,
			statePort: port,
		});

		expect(second.written).toStrictEqual({ err: stateError, success: false });
		expect(second.merged.resources).toStrictEqual([alpha, vip]);
	});

	it("should snapshot only the survivors when an op in the pass fails to apply", async () => {
		expect.assertions(2);

		const failure = new OpenCloudError("create vip-pass: 503");
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: {
				async create(desired) {
					return desired.key === "alpha-pass"
						? { data: alpha, success: true }
						: { err: failure, success: false };
				},
			},
			place: placeStub,
			universe: universeStub,
		};
		const { port, writes } = inMemoryStatePort();
		const { port: progress } = recordingProgress();

		const pass = await applyAndPersist({
			environment: "production",
			ops: [
				createGamePassOp(asResourceKey("alpha-pass")),
				createGamePassOp(asResourceKey("vip-pass")),
			],
			priorResources: [],
			progress,
			registry,
			statePort: port,
		});

		expect(pass.applied.success).toBeFalse();
		expect(writes[0]).toStrictEqual([alpha]);
	});
});
