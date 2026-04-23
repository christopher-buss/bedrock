import { OpenCloudError } from "@bedrock/ocale";

import { assert, describe, expect, it, vi } from "vitest";

import type { CreateOperation, UpdateOperation } from "../core/operations.ts";
import type {
	GamePassDesiredState,
	PlaceDesiredState,
	ResourceCurrentState,
} from "../core/resources.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex, type ResourceKey } from "../types/ids.ts";
import { applyOps } from "./apply-ops.ts";

const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
const PLACE_HASH = asSha256Hex("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");

function gamePassDesired(overrides?: Partial<GamePassDesiredState>): GamePassDesiredState {
	return {
		key: asResourceKey("vip-pass"),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		iconFileHash: ICON_HASH,
		iconFilePath: "assets/vip-icon.png",
		kind: "gamePass",
		price: 500,
		...overrides,
	};
}

function currentFrom(desired: GamePassDesiredState): ResourceCurrentState<"gamePass"> {
	return {
		...desired,
		outputs: {
			assetId: asRobloxAssetId("9876543210"),
			iconAssetId: asRobloxAssetId("1122334455"),
		},
	};
}

const placeStub: ResourceDriver<"place"> = {
	async create() {
		return { err: new OpenCloudError("place stub"), success: false };
	},
};

function placeDesired(overrides?: Partial<PlaceDesiredState>): PlaceDesiredState {
	return {
		key: asResourceKey("start-place"),
		fileHash: PLACE_HASH,
		filePath: "places/start.rbxl",
		kind: "place",
		placeId: asRobloxAssetId("4711"),
		...overrides,
	};
}

function placeCurrentFrom(desired: PlaceDesiredState): ResourceCurrentState<"place"> {
	return { ...desired, outputs: { versionNumber: 1 } };
}

function createOp(key: ResourceKey) {
	const desired = gamePassDesired({ key });
	return { key, desired, type: "create" } as const satisfies CreateOperation;
}

function updateOp(key: ResourceKey) {
	const desired = gamePassDesired({ key });
	return {
		key,
		current: currentFrom(desired),
		desired,
		type: "update",
	} as const satisfies UpdateOperation;
}

function registryWith(
	create: ResourceDriver<"gamePass">["create"],
	update?: ResourceDriver<"gamePass">["update"],
): DriverRegistry {
	return {
		gamePass: update ? { create, update } : { create },
		place: placeStub,
	};
}

describe(applyOps, () => {
	it("should return Ok undefined and never invoke the driver when ops is empty", async () => {
		expect.assertions(2);

		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();

		const result = await applyOps([], registryWith(create));

		expect(result).toStrictEqual({ data: undefined, success: true });
		expect(create).not.toHaveBeenCalled();
	});

	it("should dispatch a create op to the matching driver and return Ok on success", async () => {
		expect.assertions(3);

		const op = createOp(asResourceKey("vip-pass"));
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: currentFrom(op.desired), success: true });

		const result = await applyOps([op], registryWith(create));

		expect(result).toStrictEqual({ data: undefined, success: true });
		expect(create).toHaveBeenCalledOnce();
		expect(create.mock.calls[0]![0]).toBe(op.desired);
	});

	it("should dispatch the create and skip the noop when mixed", async () => {
		expect.assertions(2);

		const op = createOp(asResourceKey("vip-pass"));
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: currentFrom(op.desired), success: true });

		const result = await applyOps(
			[op, { key: asResourceKey("sync-pass"), type: "noop" }],
			registryWith(create),
		);

		expect(result).toStrictEqual({ data: undefined, success: true });
		expect(create).toHaveBeenCalledOnce();
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
			.mockImplementation(async (desired) => ({ data: currentFrom(desired), success: true }));

		const result = await applyOps(ops, registryWith(create));

		expect(result).toStrictEqual({ data: undefined, success: true });
		expect(create.mock.calls.map((call) => call[0].key)).toStrictEqual([
			"first-pass",
			"second-pass",
			"third-pass",
		]);
	});

	it("should stop dispatching on the first driver failure and wrap it in driverFailure Err", async () => {
		expect.assertions(3);

		const first = createOp(asResourceKey("first-pass"));
		const second = createOp(asResourceKey("second-pass"));
		const third = createOp(asResourceKey("third-pass"));
		const cause = new OpenCloudError("boom");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValueOnce({ data: currentFrom(first.desired), success: true })
			.mockResolvedValueOnce({ err: cause, success: false });

		const result = await applyOps([first, second, third], registryWith(create));

		expect(result).toStrictEqual({
			err: { key: second.key, cause, kind: "driverFailure" },
			success: false,
		});
		expect(create).toHaveBeenCalledTimes(2);
		expect(create.mock.calls.map((call) => call[0].key)).toStrictEqual([
			"first-pass",
			"second-pass",
		]);
	});

	it("should return an updateUnsupported Err when the driver has no update method", async () => {
		expect.assertions(2);

		const update = updateOp(asResourceKey("vip-pass"));
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();

		const result = await applyOps(
			[update, createOp(asResourceKey("other-pass"))],
			registryWith(create),
		);

		expect(result).toStrictEqual({
			err: { key: update.key, kind: "updateUnsupported" },
			success: false,
		});
		expect(create).not.toHaveBeenCalled();
	});

	it("should dispatch an update op to the driver's update method and return Ok on success", async () => {
		expect.assertions(4);

		const op = updateOp(asResourceKey("vip-pass"));
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const update = vi
			.fn<NonNullable<ResourceDriver<"gamePass">["update"]>>()
			.mockResolvedValue({ data: currentFrom(op.desired), success: true });

		const result = await applyOps([op], registryWith(create, update));

		expect(result).toStrictEqual({ data: undefined, success: true });
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
			err: { key: first.key, cause, kind: "driverFailure" },
			success: false,
		});
		expect(create).not.toHaveBeenCalled();
	});

	describe("place kind", () => {
		function placeRegistry(
			create: ResourceDriver<"place">["create"],
			update?: ResourceDriver<"place">["update"],
		): DriverRegistry {
			return {
				gamePass: {
					create() {
						throw new Error("gamePass driver must not run for place ops");
					},
				},
				place: update ? { create, update } : { create },
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
				current: placeCurrentFrom(desired),
				desired,
				type: "update",
			} as const satisfies UpdateOperation;
		}

		it("should dispatch a place create op to the driver and return Ok on success", async () => {
			expect.assertions(2);

			const op = placeCreateOp(asResourceKey("start-place"));
			const create = vi
				.fn<ResourceDriver<"place">["create"]>()
				.mockResolvedValue({ data: placeCurrentFrom(op.desired), success: true });

			const result = await applyOps([op], placeRegistry(create));

			expect(result).toStrictEqual({ data: undefined, success: true });
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
				err: { key: op.key, cause, kind: "driverFailure" },
				success: false,
			});
		});

		it("should return updateUnsupported when the place driver has no update method", async () => {
			expect.assertions(2);

			const op = placeUpdateOp(asResourceKey("start-place"));
			const create = vi.fn<ResourceDriver<"place">["create"]>();

			const result = await applyOps([op], placeRegistry(create));

			expect(result).toStrictEqual({
				err: { key: op.key, kind: "updateUnsupported" },
				success: false,
			});
			expect(create).not.toHaveBeenCalled();
		});

		it("should dispatch a place update op to the driver's update method and return Ok on success", async () => {
			expect.assertions(3);

			const op = placeUpdateOp(asResourceKey("start-place"));
			const create = vi.fn<ResourceDriver<"place">["create"]>();
			const update = vi
				.fn<NonNullable<ResourceDriver<"place">["update"]>>()
				.mockResolvedValue({ data: placeCurrentFrom(op.desired), success: true });

			const result = await applyOps([op], placeRegistry(create, update));

			expect(result).toStrictEqual({ data: undefined, success: true });
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
				err: { key: op.key, cause, kind: "driverFailure" },
				success: false,
			});
		});

		it("should return driverFailure when op.current.kind does not match desired.kind on a place update", async () => {
			expect.assertions(2);

			const placeDesiredState = placeDesired();
			const gamePassCurrent = currentFrom(gamePassDesired({ key: placeDesiredState.key }));
			const op: UpdateOperation = {
				key: placeDesiredState.key,
				current: gamePassCurrent,
				desired: placeDesiredState,
				type: "update",
			};
			const create = vi.fn<ResourceDriver<"place">["create"]>();
			const update = vi.fn<NonNullable<ResourceDriver<"place">["update"]>>();

			const result = await applyOps([op], placeRegistry(create, update));

			assert(!result.success);

			expect(result.err.kind).toBe("driverFailure");
			expect(update).not.toHaveBeenCalled();
		});
	});
});
