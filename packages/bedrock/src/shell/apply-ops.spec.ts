import { OpenCloudError } from "@bedrock-rbx/ocale";

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
import { assert, describe, expect, it, vi } from "vitest";

import type { CreateOperation, UpdateOperation } from "../core/operations.ts";
import { UNIVERSE_SINGLETON_KEY } from "../core/resources.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import { applyOps } from "./apply-ops.ts";

const developerProductStub: ResourceDriver<"developerProduct"> = {
	async create() {
		return { err: new OpenCloudError("developerProduct stub"), success: false };
	},
};

const placeStub: ResourceDriver<"place"> = {
	async create() {
		return { err: new OpenCloudError("place stub"), success: false };
	},
};

const universeStub: ResourceDriver<"universe"> = {
	async create() {
		return { err: new OpenCloudError("universe stub"), success: false };
	},
};

function createOp(key: ResourceKey) {
	const desired = gamePassDesired({ key });
	return { key, desired, type: "create" } as const satisfies CreateOperation;
}

function updateOp(key: ResourceKey) {
	const desired = gamePassDesired({ key });
	return {
		key,
		current: gamePassCurrent({ ...desired }),
		desired,
		type: "update",
	} as const satisfies UpdateOperation;
}

function registryWith(
	create: ResourceDriver<"gamePass">["create"],
	update?: ResourceDriver<"gamePass">["update"],
): DriverRegistry {
	return {
		developerProduct: developerProductStub,
		gamePass: update ? { create, update } : { create },
		place: placeStub,
		universe: universeStub,
	};
}

describe(applyOps, () => {
	it("should return Ok with an empty array and never invoke the driver when ops is empty", async () => {
		expect.assertions(2);

		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();

		const result = await applyOps([], registryWith(create));

		expect(result).toStrictEqual({ data: [], success: true });
		expect(create).not.toHaveBeenCalled();
	});

	it("should dispatch a create op to the matching driver and return Ok on success", async () => {
		expect.assertions(3);

		const op = createOp(asResourceKey("vip-pass"));
		const created = gamePassCurrent({ ...op.desired });
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: created, success: true });

		const result = await applyOps([op], registryWith(create));

		expect(result).toStrictEqual({ data: [created], success: true });
		expect(create).toHaveBeenCalledOnce();
		expect(create.mock.calls[0]![0]).toBe(op.desired);
	});

	it("should return the driver outputs in dispatched order and skip noops", async () => {
		expect.assertions(2);

		const firstOp = createOp(asResourceKey("first-pass"));
		const secondOp = createOp(asResourceKey("second-pass"));
		const firstCurrent = gamePassCurrent({ ...firstOp.desired });
		const secondCurrent = gamePassCurrent({ ...secondOp.desired });
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValueOnce({ data: firstCurrent, success: true })
			.mockResolvedValueOnce({ data: secondCurrent, success: true });

		const result = await applyOps(
			[firstOp, { key: asResourceKey("sync-pass"), type: "noop" }, secondOp],
			registryWith(create),
		);

		expect(result).toStrictEqual({ data: [firstCurrent, secondCurrent], success: true });
		expect(create).toHaveBeenCalledTimes(2);
	});

	it("should dispatch create ops in input order", async () => {
		expect.assertions(2);

		const ops = [
			createOp(asResourceKey("first-pass")),
			createOp(asResourceKey("second-pass")),
			createOp(asResourceKey("third-pass")),
		];
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementation(async (desired) => {
				return { data: gamePassCurrent({ ...desired }), success: true };
			});

		const result = await applyOps(ops, registryWith(create));

		expect(result.success).toBeTrue();
		expect(create.mock.calls.map((call) => call[0].key)).toStrictEqual([
			"first-pass",
			"second-pass",
			"third-pass",
		]);
	});

	it("should stop dispatching on the first driver failure and surface an aggregate with applied[] and a single-failure failures[]", async () => {
		expect.assertions(3);

		const first = createOp(asResourceKey("first-pass"));
		const second = createOp(asResourceKey("second-pass"));
		const third = createOp(asResourceKey("third-pass"));
		const firstCurrent = gamePassCurrent({ ...first.desired });
		const cause = new OpenCloudError("boom");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValueOnce({ data: firstCurrent, success: true })
			.mockResolvedValueOnce({ err: cause, success: false });

		const result = await applyOps([first, second, third], registryWith(create));

		expect(result).toStrictEqual({
			err: {
				applied: [firstCurrent],
				failures: [{ key: second.key, cause, kind: "driverFailure" }],
			},
			success: false,
		});
		expect(create).toHaveBeenCalledTimes(2);
		expect(create.mock.calls.map((call) => call[0].key)).toStrictEqual([
			"first-pass",
			"second-pass",
		]);
	});

	it("should return an updateUnsupported failure in the aggregate when the driver has no update method", async () => {
		expect.assertions(2);

		const update = updateOp(asResourceKey("vip-pass"));
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();

		const result = await applyOps(
			[update, createOp(asResourceKey("other-pass"))],
			registryWith(create),
		);

		expect(result).toStrictEqual({
			err: {
				applied: [],
				failures: [{ key: update.key, kind: "updateUnsupported" }],
			},
			success: false,
		});
		expect(create).not.toHaveBeenCalled();
	});

	it("should carry preceding driver outputs in aggregate.applied on updateUnsupported", async () => {
		expect.assertions(1);

		const created = createOp(asResourceKey("first-pass"));
		const createdCurrent = gamePassCurrent({ ...created.desired });
		const update = updateOp(asResourceKey("vip-pass"));
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: createdCurrent, success: true });

		const result = await applyOps([created, update], registryWith(create));

		expect(result).toStrictEqual({
			err: {
				applied: [createdCurrent],
				failures: [{ key: update.key, kind: "updateUnsupported" }],
			},
			success: false,
		});
	});

	it("should dispatch an update op to the driver's update method and return Ok on success", async () => {
		expect.assertions(4);

		const op = updateOp(asResourceKey("vip-pass"));
		const updated = gamePassCurrent({ ...op.desired });
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const update = vi
			.fn<NonNullable<ResourceDriver<"gamePass">["update"]>>()
			.mockResolvedValue({ data: updated, success: true });

		const result = await applyOps([op], registryWith(create, update));

		expect(result).toStrictEqual({ data: [updated], success: true });
		expect(update).toHaveBeenCalledOnce();
		expect(update.mock.calls[0]![0]).toBe(op.current);
		expect(update.mock.calls[0]![1]).toBe(op.desired);
	});

	it("should stop dispatching on the first update failure and wrap it in driverFailure Err", async () => {
		expect.assertions(2);

		const first = updateOp(asResourceKey("first-pass"));
		const second = createOp(asResourceKey("second-pass"));
		const cause = new OpenCloudError("boom");
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const update = vi
			.fn<NonNullable<ResourceDriver<"gamePass">["update"]>>()
			.mockResolvedValue({ err: cause, success: false });

		const result = await applyOps([first, second], registryWith(create, update));

		expect(result).toStrictEqual({
			err: {
				applied: [],
				failures: [{ key: first.key, cause, kind: "driverFailure" }],
			},
			success: false,
		});
		expect(create).not.toHaveBeenCalled();
	});

	describe("developerProduct kind", () => {
		function developerProductRegistry(
			create: ResourceDriver<"developerProduct">["create"],
			update?: ResourceDriver<"developerProduct">["update"],
		): DriverRegistry {
			return {
				developerProduct: update ? { create, update } : { create },
				gamePass: {
					create() {
						throw new Error("gamePass driver must not run for developerProduct ops");
					},
				},
				place: placeStub,
				universe: universeStub,
			};
		}

		function developerProductCreateOp(key: ResourceKey) {
			const desired = developerProductDesired({ key });
			return { key, desired, type: "create" } as const satisfies CreateOperation;
		}

		function developerProductUpdateOp(key: ResourceKey) {
			const desired = developerProductDesired({ key });
			return {
				key,
				current: developerProductCurrent({ ...desired }),
				desired,
				type: "update",
			} as const satisfies UpdateOperation;
		}

		it("should dispatch a developerProduct create op to the driver and return Ok on success", async () => {
			expect.assertions(2);

			const op = developerProductCreateOp(asResourceKey("gem-pack"));
			const created = developerProductCurrent({ ...op.desired });
			const create = vi
				.fn<ResourceDriver<"developerProduct">["create"]>()
				.mockResolvedValue({ data: created, success: true });

			const result = await applyOps([op], developerProductRegistry(create));

			expect(result).toStrictEqual({ data: [created], success: true });
			expect(create).toHaveBeenCalledExactlyOnceWith(op.desired);
		});

		it("should wrap a developerProduct create failure in driverFailure Err", async () => {
			expect.assertions(1);

			const op = developerProductCreateOp(asResourceKey("gem-pack"));
			const cause = new OpenCloudError("boom");
			const create = vi
				.fn<ResourceDriver<"developerProduct">["create"]>()
				.mockResolvedValue({ err: cause, success: false });

			const result = await applyOps([op], developerProductRegistry(create));

			expect(result).toStrictEqual({
				err: {
					applied: [],
					failures: [{ key: op.key, cause, kind: "driverFailure" }],
				},
				success: false,
			});
		});

		it("should return updateUnsupported when the developerProduct driver has no update method", async () => {
			expect.assertions(2);

			const op = developerProductUpdateOp(asResourceKey("gem-pack"));
			const create = vi.fn<ResourceDriver<"developerProduct">["create"]>();

			const result = await applyOps([op], developerProductRegistry(create));

			expect(result).toStrictEqual({
				err: {
					applied: [],
					failures: [{ key: op.key, kind: "updateUnsupported" }],
				},
				success: false,
			});
			expect(create).not.toHaveBeenCalled();
		});

		it("should dispatch a developerProduct update op to the driver's update method and return Ok on success", async () => {
			expect.assertions(3);

			const op = developerProductUpdateOp(asResourceKey("gem-pack"));
			const updated = developerProductCurrent({ ...op.desired });
			const create = vi.fn<ResourceDriver<"developerProduct">["create"]>();
			const update = vi
				.fn<NonNullable<ResourceDriver<"developerProduct">["update"]>>()
				.mockResolvedValue({ data: updated, success: true });

			const result = await applyOps([op], developerProductRegistry(create, update));

			expect(result).toStrictEqual({ data: [updated], success: true });
			expect(update).toHaveBeenCalledExactlyOnceWith(op.current, op.desired);
			expect(create).not.toHaveBeenCalled();
		});

		it("should wrap a developerProduct update failure in driverFailure Err", async () => {
			expect.assertions(1);

			const op = developerProductUpdateOp(asResourceKey("gem-pack"));
			const cause = new OpenCloudError("boom");
			const create = vi.fn<ResourceDriver<"developerProduct">["create"]>();
			const update = vi
				.fn<NonNullable<ResourceDriver<"developerProduct">["update"]>>()
				.mockResolvedValue({ err: cause, success: false });

			const result = await applyOps([op], developerProductRegistry(create, update));

			expect(result).toStrictEqual({
				err: {
					applied: [],
					failures: [{ key: op.key, cause, kind: "driverFailure" }],
				},
				success: false,
			});
		});
	});

	describe("place kind", () => {
		function placeRegistry(
			create: ResourceDriver<"place">["create"],
			update?: ResourceDriver<"place">["update"],
		): DriverRegistry {
			return {
				developerProduct: developerProductStub,
				gamePass: {
					create() {
						throw new Error("gamePass driver must not run for place ops");
					},
				},
				place: update ? { create, update } : { create },
				universe: universeStub,
			};
		}

		function placeCreateOp(key: ResourceKey) {
			const desired = placeDesired({ key });
			return { key, desired, type: "create" } as const satisfies CreateOperation;
		}

		function placeUpdateOp(key: ResourceKey) {
			const desired = placeDesired({ key });
			return {
				key,
				current: placeCurrent({ ...desired }),
				desired,
				type: "update",
			} as const satisfies UpdateOperation;
		}

		it("should dispatch a place create op to the driver and return Ok on success", async () => {
			expect.assertions(2);

			const op = placeCreateOp(asResourceKey("start-place"));
			const created = placeCurrent({ ...op.desired });
			const create = vi
				.fn<ResourceDriver<"place">["create"]>()
				.mockResolvedValue({ data: created, success: true });

			const result = await applyOps([op], placeRegistry(create));

			expect(result).toStrictEqual({ data: [created], success: true });
			expect(create).toHaveBeenCalledExactlyOnceWith(op.desired);
		});

		it("should wrap a place create failure in driverFailure Err", async () => {
			expect.assertions(1);

			const op = placeCreateOp(asResourceKey("start-place"));
			const cause = new OpenCloudError("boom");
			const create = vi
				.fn<ResourceDriver<"place">["create"]>()
				.mockResolvedValue({ err: cause, success: false });

			const result = await applyOps([op], placeRegistry(create));

			expect(result).toStrictEqual({
				err: {
					applied: [],
					failures: [{ key: op.key, cause, kind: "driverFailure" }],
				},
				success: false,
			});
		});

		it("should return updateUnsupported when the place driver has no update method", async () => {
			expect.assertions(2);

			const op = placeUpdateOp(asResourceKey("start-place"));
			const create = vi.fn<ResourceDriver<"place">["create"]>();

			const result = await applyOps([op], placeRegistry(create));

			expect(result).toStrictEqual({
				err: {
					applied: [],
					failures: [{ key: op.key, kind: "updateUnsupported" }],
				},
				success: false,
			});
			expect(create).not.toHaveBeenCalled();
		});

		it("should dispatch a place update op to the driver's update method and return Ok on success", async () => {
			expect.assertions(3);

			const op = placeUpdateOp(asResourceKey("start-place"));
			const updated = placeCurrent({ ...op.desired });
			const create = vi.fn<ResourceDriver<"place">["create"]>();
			const update = vi
				.fn<NonNullable<ResourceDriver<"place">["update"]>>()
				.mockResolvedValue({ data: updated, success: true });

			const result = await applyOps([op], placeRegistry(create, update));

			expect(result).toStrictEqual({ data: [updated], success: true });
			expect(update).toHaveBeenCalledExactlyOnceWith(op.current, op.desired);
			expect(create).not.toHaveBeenCalled();
		});

		it("should wrap a place update failure in driverFailure Err", async () => {
			expect.assertions(1);

			const op = placeUpdateOp(asResourceKey("start-place"));
			const cause = new OpenCloudError("boom");
			const create = vi.fn<ResourceDriver<"place">["create"]>();
			const update = vi
				.fn<NonNullable<ResourceDriver<"place">["update"]>>()
				.mockResolvedValue({ err: cause, success: false });

			const result = await applyOps([op], placeRegistry(create, update));

			expect(result).toStrictEqual({
				err: {
					applied: [],
					failures: [{ key: op.key, cause, kind: "driverFailure" }],
				},
				success: false,
			});
		});

		it("should return driverFailure with a kind-mismatch message when op.current.kind does not match place", async () => {
			expect.assertions(4);

			const placeDesiredState = placeDesired();
			const crossKindCurrent = gamePassCurrent({ key: placeDesiredState.key });
			const op: UpdateOperation = {
				key: placeDesiredState.key,
				current: crossKindCurrent,
				desired: placeDesiredState,
				type: "update",
			};
			const create = vi.fn<ResourceDriver<"place">["create"]>();
			const update = vi.fn<NonNullable<ResourceDriver<"place">["update"]>>();

			const result = await applyOps([op], placeRegistry(create, update));

			assert(!result.success);
			const failure = result.err.failures[0];
			assert(failure.kind === "driverFailure");

			expect(failure.cause.message).toContain("expected place");
			expect(failure.cause.message).toContain("got gamePass");
			expect(failure.cause.message).toContain(op.key);
			expect(update).not.toHaveBeenCalled();
		});
	});

	describe("cross-kind current-state for gamePass update", () => {
		it("should return driverFailure with a kind-mismatch message when op.current.kind does not match gamePass", async () => {
			expect.assertions(4);

			const crossKindCurrent = placeCurrent({ key: asResourceKey("vip-pass") });
			const op: UpdateOperation = {
				key: crossKindCurrent.key,
				current: crossKindCurrent,
				desired: gamePassDesired({ key: crossKindCurrent.key }),
				type: "update",
			};
			const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
			const update = vi.fn<NonNullable<ResourceDriver<"gamePass">["update"]>>();

			const result = await applyOps([op], registryWith(create, update));

			assert(!result.success);
			const failure = result.err.failures[0];
			assert(failure.kind === "driverFailure");

			expect(failure.cause.message).toContain("expected gamePass");
			expect(failure.cause.message).toContain("got place");
			expect(failure.cause.message).toContain(op.key);
			expect(update).not.toHaveBeenCalled();
		});
	});

	describe("universe kind", () => {
		function universeRegistry(
			create: ResourceDriver<"universe">["create"],
			update?: ResourceDriver<"universe">["update"],
		): DriverRegistry {
			return {
				developerProduct: developerProductStub,
				gamePass: {
					create() {
						throw new Error("gamePass driver must not run for universe ops");
					},
				},
				place: placeStub,
				universe: update ? { create, update } : { create },
			};
		}

		function universeCreateOp() {
			const desired = universeDesired({ voiceChatEnabled: true });
			return {
				key: UNIVERSE_SINGLETON_KEY,
				desired,
				type: "create",
			} as const satisfies CreateOperation;
		}

		function universeUpdateOp() {
			const desired = universeDesired({ voiceChatEnabled: true });
			return {
				key: UNIVERSE_SINGLETON_KEY,
				current: universeCurrent({ ...desired, voiceChatEnabled: false }),
				desired,
				type: "update",
			} as const satisfies UpdateOperation;
		}

		it("should dispatch a universe create op to the driver and return Ok on success", async () => {
			expect.assertions(2);

			const op = universeCreateOp();
			const created = universeCurrent({ ...op.desired });
			const create = vi
				.fn<ResourceDriver<"universe">["create"]>()
				.mockResolvedValue({ data: created, success: true });

			const result = await applyOps([op], universeRegistry(create));

			expect(result).toStrictEqual({ data: [created], success: true });
			expect(create).toHaveBeenCalledExactlyOnceWith(op.desired);
		});

		it("should wrap a universe create failure in driverFailure Err", async () => {
			expect.assertions(1);

			const op = universeCreateOp();
			const cause = new OpenCloudError("boom");
			const create = vi
				.fn<ResourceDriver<"universe">["create"]>()
				.mockResolvedValue({ err: cause, success: false });

			const result = await applyOps([op], universeRegistry(create));

			expect(result).toStrictEqual({
				err: {
					applied: [],
					failures: [{ key: op.key, cause, kind: "driverFailure" }],
				},
				success: false,
			});
		});

		it("should return updateUnsupported when the universe driver has no update method", async () => {
			expect.assertions(2);

			const op = universeUpdateOp();
			const create = vi.fn<ResourceDriver<"universe">["create"]>();

			const result = await applyOps([op], universeRegistry(create));

			expect(result).toStrictEqual({
				err: {
					applied: [],
					failures: [{ key: op.key, kind: "updateUnsupported" }],
				},
				success: false,
			});
			expect(create).not.toHaveBeenCalled();
		});

		it("should dispatch a universe update op to the driver's update method and return Ok on success", async () => {
			expect.assertions(3);

			const op = universeUpdateOp();
			const updated = universeCurrent({ ...op.desired });
			const create = vi.fn<ResourceDriver<"universe">["create"]>();
			const update = vi
				.fn<NonNullable<ResourceDriver<"universe">["update"]>>()
				.mockResolvedValue({ data: updated, success: true });

			const result = await applyOps([op], universeRegistry(create, update));

			expect(result).toStrictEqual({ data: [updated], success: true });
			expect(update).toHaveBeenCalledExactlyOnceWith(op.current, op.desired);
			expect(create).not.toHaveBeenCalled();
		});

		it("should wrap a universe update failure in driverFailure Err", async () => {
			expect.assertions(1);

			const op = universeUpdateOp();
			const cause = new OpenCloudError("boom");
			const create = vi.fn<ResourceDriver<"universe">["create"]>();
			const update = vi
				.fn<NonNullable<ResourceDriver<"universe">["update"]>>()
				.mockResolvedValue({ err: cause, success: false });

			const result = await applyOps([op], universeRegistry(create, update));

			expect(result).toStrictEqual({
				err: {
					applied: [],
					failures: [{ key: op.key, cause, kind: "driverFailure" }],
				},
				success: false,
			});
		});

		it("should return driverFailure with a kind-mismatch message when op.current.kind does not match universe", async () => {
			expect.assertions(4);

			const universeDesiredState = universeDesired({ voiceChatEnabled: true });
			const crossKindCurrent = gamePassCurrent({ key: universeDesiredState.key });
			const op: UpdateOperation = {
				key: universeDesiredState.key,
				current: crossKindCurrent,
				desired: universeDesiredState,
				type: "update",
			};
			const create = vi.fn<ResourceDriver<"universe">["create"]>();
			const update = vi.fn<NonNullable<ResourceDriver<"universe">["update"]>>();

			const result = await applyOps([op], universeRegistry(create, update));

			assert(!result.success);
			const failure = result.err.failures[0];
			assert(failure.kind === "driverFailure");

			expect(failure.cause.message).toContain("expected universe");
			expect(failure.cause.message).toContain("got gamePass");
			expect(failure.cause.message).toContain(op.key);
			expect(update).not.toHaveBeenCalled();
		});
	});
});
