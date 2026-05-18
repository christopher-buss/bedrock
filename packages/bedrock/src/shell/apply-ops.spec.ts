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

	it("should dispatch universe ops in Phase 1 before any non-universe op regardless of input position", async () => {
		expect.assertions(2);

		const callOrder: Array<string> = [];
		const gamePassOp = createOp(asResourceKey("vip-pass"));
		const universeOp = {
			key: UNIVERSE_SINGLETON_KEY,
			desired: universeDesired({ voiceChatEnabled: true }),
			type: "create",
		} as const satisfies CreateOperation;
		const placeOp = {
			key: asResourceKey("start-place"),
			desired: placeDesired(),
			type: "create",
		} as const satisfies CreateOperation;
		const gamePassCreate = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementation(async (desired) => {
				callOrder.push(`gamePass:${desired.key}`);
				return { data: gamePassCurrent({ ...desired }), success: true };
			});
		const universeCreate = vi
			.fn<ResourceDriver<"universe">["create"]>()
			.mockImplementation(async (desired) => {
				callOrder.push(`universe:${desired.key}`);
				return { data: universeCurrent({ ...desired }), success: true };
			});
		const placeCreate = vi
			.fn<ResourceDriver<"place">["create"]>()
			.mockImplementation(async (desired) => {
				callOrder.push(`place:${desired.key}`);
				return { data: placeCurrent({ ...desired }), success: true };
			});
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create: gamePassCreate },
			place: { create: placeCreate },
			universe: { create: universeCreate },
		};

		const result = await applyOps([gamePassOp, universeOp, placeOp], registry);

		expect(result.success).toBeTrue();
		expect(callOrder).toStrictEqual([
			`universe:${UNIVERSE_SINGLETON_KEY}`,
			"gamePass:vip-pass",
			"place:start-place",
		]);
	});

	it("should still dispatch non-universe ops when no universe op is in the input", async () => {
		expect.assertions(2);

		const op = createOp(asResourceKey("vip-pass"));
		const created = gamePassCurrent({ ...op.desired });
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: created, success: true });

		const result = await applyOps([op], registryWith(create));

		expect(result).toStrictEqual({ data: [created], success: true });
		expect(create).toHaveBeenCalledOnce();
	});

	it("should treat a 'main'-keyed place and 'main'-keyed universe as independent partitions", async () => {
		expect.assertions(3);

		const placeOp = {
			key: UNIVERSE_SINGLETON_KEY,
			desired: placeDesired({ key: UNIVERSE_SINGLETON_KEY }),
			type: "create",
		} as const satisfies CreateOperation;
		const universeOp = {
			key: UNIVERSE_SINGLETON_KEY,
			desired: universeDesired({ voiceChatEnabled: true }),
			type: "create",
		} as const satisfies CreateOperation;
		const placeCreated = placeCurrent({ ...placeOp.desired });
		const universeCreated = universeCurrent({ ...universeOp.desired });
		const placeCreate = vi
			.fn<ResourceDriver<"place">["create"]>()
			.mockResolvedValue({ data: placeCreated, success: true });
		const universeCreate = vi
			.fn<ResourceDriver<"universe">["create"]>()
			.mockResolvedValue({ data: universeCreated, success: true });
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: {
				create() {
					throw new Error("gamePass driver must not run");
				},
			},
			place: { create: placeCreate },
			universe: { create: universeCreate },
		};

		const result = await applyOps([placeOp, universeOp], registry);

		expect(result.success).toBeTrue();
		expect(placeCreate).toHaveBeenCalledOnce();
		expect(universeCreate).toHaveBeenCalledOnce();
	});

	it("should run Phase 2 even when the Phase 1 universe op fails", async () => {
		expect.assertions(4);

		const universeOp = {
			key: UNIVERSE_SINGLETON_KEY,
			desired: universeDesired({ voiceChatEnabled: true }),
			type: "create",
		} as const satisfies CreateOperation;
		const gamePassOp = createOp(asResourceKey("vip-pass"));
		const placeOp = {
			key: asResourceKey("start-place"),
			desired: placeDesired(),
			type: "create",
		} as const satisfies CreateOperation;
		const gamePassCurrentState = gamePassCurrent({ ...gamePassOp.desired });
		const placeCurrentState = placeCurrent({ ...placeOp.desired });
		const universeCause = new OpenCloudError("universe boom");
		const gamePassCreate = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: gamePassCurrentState, success: true });
		const universeCreate = vi
			.fn<ResourceDriver<"universe">["create"]>()
			.mockResolvedValue({ err: universeCause, success: false });
		const placeCreate = vi
			.fn<ResourceDriver<"place">["create"]>()
			.mockResolvedValue({ data: placeCurrentState, success: true });
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create: gamePassCreate },
			place: { create: placeCreate },
			universe: { create: universeCreate },
		};

		const result = await applyOps([gamePassOp, universeOp, placeOp], registry);

		expect(gamePassCreate).toHaveBeenCalledOnce();
		expect(placeCreate).toHaveBeenCalledOnce();
		expect(universeCreate).toHaveBeenCalledOnce();
		expect(result).toStrictEqual({
			err: {
				applied: [gamePassCurrentState, placeCurrentState],
				failures: [
					{ key: UNIVERSE_SINGLETON_KEY, cause: universeCause, kind: "driverFailure" },
				],
			},
			success: false,
		});
	});

	it("should aggregate failures from both Phase 1 and Phase 2", async () => {
		expect.assertions(2);

		const universeOp = {
			key: UNIVERSE_SINGLETON_KEY,
			desired: universeDesired({ voiceChatEnabled: true }),
			type: "create",
		} as const satisfies CreateOperation;
		const gamePassOp = createOp(asResourceKey("vip-pass"));
		const universeCause = new OpenCloudError("universe boom");
		const gamePassCause = new OpenCloudError("gamePass boom");
		const universeCreate = vi
			.fn<ResourceDriver<"universe">["create"]>()
			.mockResolvedValue({ err: universeCause, success: false });
		const gamePassCreate = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ err: gamePassCause, success: false });
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create: gamePassCreate },
			place: placeStub,
			universe: { create: universeCreate },
		};

		const result = await applyOps([universeOp, gamePassOp], registry);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err).toStrictEqual({
			applied: [],
			failures: [
				{ key: UNIVERSE_SINGLETON_KEY, cause: universeCause, kind: "driverFailure" },
				{ key: gamePassOp.key, cause: gamePassCause, kind: "driverFailure" },
			],
		});
	});

	it("should dispatch Phase 2 ops concurrently rather than serially", async () => {
		expect.assertions(3);

		const first = createOp(asResourceKey("first-pass"));
		const second = createOp(asResourceKey("second-pass"));
		let resolveFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		const firstCurrent = gamePassCurrent({ ...first.desired });
		const secondCurrent = gamePassCurrent({ ...second.desired });
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementationOnce(async () => {
				await firstGate;
				return { data: firstCurrent, success: true };
			})
			.mockImplementationOnce(async () => {
				return { data: secondCurrent, success: true };
			});

		const applyPromise = applyOps([first, second], registryWith(create));
		await Promise.resolve();
		await Promise.resolve();

		expect(create).toHaveBeenCalledTimes(2);

		resolveFirst();
		const result = await applyPromise;

		expect(result.success).toBeTrue();
		expect(result).toStrictEqual({ data: [firstCurrent, secondCurrent], success: true });
	});

	it("should preserve applied[] in declaration order even when Phase 2 ops settle out of order", async () => {
		expect.assertions(1);

		const first = createOp(asResourceKey("first-pass"));
		const second = createOp(asResourceKey("second-pass"));
		let resolveFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		const firstCurrent = gamePassCurrent({ ...first.desired });
		const secondCurrent = gamePassCurrent({ ...second.desired });
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementationOnce(async () => {
				await firstGate;
				return { data: firstCurrent, success: true };
			})
			.mockImplementationOnce(async () => {
				queueMicrotask(resolveFirst);
				return { data: secondCurrent, success: true };
			});

		const result = await applyOps([first, second], registryWith(create));

		expect(result).toStrictEqual({ data: [firstCurrent, secondCurrent], success: true });
	});

	it("should preserve failures[] in declaration order even when Phase 2 failures settle out of order", async () => {
		expect.assertions(1);

		const first = createOp(asResourceKey("first-pass"));
		const second = createOp(asResourceKey("second-pass"));
		let resolveFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		const firstCause = new OpenCloudError("first boom");
		const secondCause = new OpenCloudError("second boom");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementationOnce(async () => {
				await firstGate;
				return { err: firstCause, success: false };
			})
			.mockImplementationOnce(async () => {
				queueMicrotask(resolveFirst);
				return { err: secondCause, success: false };
			});

		const result = await applyOps([first, second], registryWith(create));

		expect(result).toStrictEqual({
			err: {
				applied: [],
				failures: [
					{ key: first.key, cause: firstCause, kind: "driverFailure" },
					{ key: second.key, cause: secondCause, kind: "driverFailure" },
				],
			},
			success: false,
		});
	});

	it("should translate a synchronous driver throw into an unexpectedThrow without halting the batch", async () => {
		expect.assertions(3);

		const first = createOp(asResourceKey("first-pass"));
		const second = createOp(asResourceKey("second-pass"));
		const third = createOp(asResourceKey("third-pass"));
		const firstCurrent = gamePassCurrent({ ...first.desired });
		const thirdCurrent = gamePassCurrent({ ...third.desired });
		const thrown = new Error("boom");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValueOnce({ data: firstCurrent, success: true })
			.mockImplementationOnce(() => {
				throw thrown;
			})
			.mockResolvedValueOnce({ data: thirdCurrent, success: true });

		const result = await applyOps([first, second, third], registryWith(create));

		expect(result).toStrictEqual({
			err: {
				applied: [firstCurrent, thirdCurrent],
				failures: [{ key: second.key, cause: thrown, kind: "unexpectedThrow" }],
			},
			success: false,
		});
		expect(create).toHaveBeenCalledTimes(3);
		expect(create.mock.calls.map((call) => call[0].key)).toStrictEqual([
			"first-pass",
			"second-pass",
			"third-pass",
		]);
	});

	it("should translate an async driver rejection into an unexpectedThrow", async () => {
		expect.assertions(1);

		const op = createOp(asResourceKey("vip-pass"));
		const thrown = new Error("async boom");
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>().mockRejectedValue(thrown);

		const result = await applyOps([op], registryWith(create));

		expect(result).toStrictEqual({
			err: {
				applied: [],
				failures: [{ key: op.key, cause: thrown, kind: "unexpectedThrow" }],
			},
			success: false,
		});
	});

	it("should preserve a non-Error throw as the unexpectedThrow cause", async () => {
		expect.assertions(1);

		const op = createOp(asResourceKey("vip-pass"));
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>().mockImplementation(() => {
			// eslint-disable-next-line ts/only-throw-error -- exercise non-Error throw
			throw "string error";
		});

		const result = await applyOps([op], registryWith(create));

		expect(result).toStrictEqual({
			err: {
				applied: [],
				failures: [{ key: op.key, cause: "string error", kind: "unexpectedThrow" }],
			},
			success: false,
		});
	});

	it("should translate a universe-driver throw in Phase 1 into an unexpectedThrow alongside Phase 2 ops", async () => {
		expect.assertions(2);

		const universeOp = {
			key: UNIVERSE_SINGLETON_KEY,
			desired: universeDesired({ voiceChatEnabled: true }),
			type: "create",
		} as const satisfies CreateOperation;
		const gamePassOp = createOp(asResourceKey("vip-pass"));
		const gamePassCurrentState = gamePassCurrent({ ...gamePassOp.desired });
		const thrown = new Error("universe driver crashed");
		const universeCreate = vi
			.fn<ResourceDriver<"universe">["create"]>()
			.mockImplementation(() => {
				throw thrown;
			});
		const gamePassCreate = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: gamePassCurrentState, success: true });
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create: gamePassCreate },
			place: placeStub,
			universe: { create: universeCreate },
		};

		const result = await applyOps([universeOp, gamePassOp], registry);

		expect(gamePassCreate).toHaveBeenCalledOnce();
		expect(result).toStrictEqual({
			err: {
				applied: [gamePassCurrentState],
				failures: [{ key: UNIVERSE_SINGLETON_KEY, cause: thrown, kind: "unexpectedThrow" }],
			},
			success: false,
		});
	});

	it("should dispatch every Phase 2 op past a failure and aggregate survivors with the failure", async () => {
		expect.assertions(3);

		const first = createOp(asResourceKey("first-pass"));
		const second = createOp(asResourceKey("second-pass"));
		const third = createOp(asResourceKey("third-pass"));
		const firstCurrent = gamePassCurrent({ ...first.desired });
		const thirdCurrent = gamePassCurrent({ ...third.desired });
		const cause = new OpenCloudError("boom");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValueOnce({ data: firstCurrent, success: true })
			.mockResolvedValueOnce({ err: cause, success: false })
			.mockResolvedValueOnce({ data: thirdCurrent, success: true });

		const result = await applyOps([first, second, third], registryWith(create));

		expect(result).toStrictEqual({
			err: {
				applied: [firstCurrent, thirdCurrent],
				failures: [{ key: second.key, cause, kind: "driverFailure" }],
			},
			success: false,
		});
		expect(create).toHaveBeenCalledTimes(3);
		expect(create.mock.calls.map((call) => call[0].key)).toStrictEqual([
			"first-pass",
			"second-pass",
			"third-pass",
		]);
	});

	it("should aggregate updateUnsupported failures alongside concurrent Phase 2 successes", async () => {
		expect.assertions(2);

		const update = updateOp(asResourceKey("vip-pass"));
		const otherCreate = createOp(asResourceKey("other-pass"));
		const otherCurrent = gamePassCurrent({ ...otherCreate.desired });
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: otherCurrent, success: true });

		const result = await applyOps([update, otherCreate], registryWith(create));

		expect(result).toStrictEqual({
			err: {
				applied: [otherCurrent],
				failures: [{ key: update.key, kind: "updateUnsupported" }],
			},
			success: false,
		});
		expect(create).toHaveBeenCalledExactlyOnceWith(otherCreate.desired);
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

	it("should aggregate an update failure alongside the concurrent Phase 2 successes", async () => {
		expect.assertions(2);

		const first = updateOp(asResourceKey("first-pass"));
		const second = createOp(asResourceKey("second-pass"));
		const secondCurrent = gamePassCurrent({ ...second.desired });
		const cause = new OpenCloudError("boom");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: secondCurrent, success: true });
		const update = vi
			.fn<NonNullable<ResourceDriver<"gamePass">["update"]>>()
			.mockResolvedValue({ err: cause, success: false });

		const result = await applyOps([first, second], registryWith(create, update));

		expect(result).toStrictEqual({
			err: {
				applied: [secondCurrent],
				failures: [{ key: first.key, cause, kind: "driverFailure" }],
			},
			success: false,
		});
		expect(create).toHaveBeenCalledExactlyOnceWith(second.desired);
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
