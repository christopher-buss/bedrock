import { ApiError, type OpenCloudError, type Result } from "@bedrock-rbx/ocale";

import { describe, it, vi } from "vitest";

import {
	badgeCurrent,
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
} from "#tests/helpers/resources";
import type { LiveSnapshot, ResourceLiveState } from "../core/live-state.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { ProgressEvent, ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { RobloxAssetId } from "../types/ids.ts";
import { recoverCreates } from "./recover-creates.ts";

type Recoverable = "badge" | "developerProduct" | "gamePass";

const UNAVAILABLE = new ApiError("Service unavailable", { statusCode: 503 });

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

function failing<K extends Recoverable>(
	listed: ReadonlyMap<RobloxAssetId, ResourceLiveState<K>>,
): ResourceDriver<K> {
	return {
		create: vi.fn<ResourceDriver<K>["create"]>(async () => {
			return { err: UNAVAILABLE, success: false } satisfies Result<never, OpenCloudError>;
		}),
		list: async () => ({ data: listed, success: true }),
		retire: trap.retire,
	};
}

function registryWith(drivers: Partial<DriverRegistry>): DriverRegistry {
	return {
		badge: trap,
		developerProduct: trap,
		gamePass: trap,
		place: trap,
		universe: trap,
		...drivers,
	};
}

const badge = badgeCurrent();
const product = developerProductCurrent();
const pass = gamePassCurrent();

describe(recoverCreates, () => {
	it("should recover a failed badge create", async ({ expect }) => {
		expect.assertions(2);

		const events: Array<ProgressEvent> = [];
		const { badgeId, iconImageId } = badge.outputs;
		const registry = recoverCreates(
			registryWith({
				badge: failing(
					new Map([
						[
							badgeId,
							{
								name: badge.name,
								description: badge.description,
								enabled: badge.enabled,
								kind: "badge",
								outputs: { iconImageId },
							},
						],
					]),
				),
			}),
			{
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
				snapshot: { badge: new Map() },
			},
		);
		const { outputs: _outputs, ...desired } = badge;

		await expect(registry.badge.create(desired)).resolves.toStrictEqual({
			data: badge,
			success: true,
		});
		expect(events).toStrictEqual([
			{
				key: badge.key,
				cause: UNAVAILABLE,
				environment: "production",
				kind: "createRecovered",
				resourceKind: "badge",
				robloxId: badgeId,
			},
		]);
	});

	it("should recover a failed developer-product create", async ({ expect }) => {
		expect.assertions(1);

		const registry = recoverCreates(
			registryWith({
				developerProduct: failing(
					new Map([
						[
							product.outputs.productId,
							{
								name: product.name,
								description: product.description,
								kind: "developerProduct",
								outputs: {},
								price: product.price,
							},
						],
					]),
				),
			}),
			{
				environment: "production",
				progress: { emit: vi.fn<ProgressPort["emit"]>() },
				snapshot: { developerProduct: new Map() },
			},
		);
		const { outputs: _outputs, ...desired } = product;

		await expect(registry.developerProduct.create(desired)).resolves.toStrictEqual({
			data: product,
			success: true,
		});
	});

	it.for<[string, LiveSnapshot]>([
		["its Kind was not listed before Apply", {}],
		["its Driver cannot list", { gamePass: new Map() }],
	])("should leave a create unwrapped when %s", ([, snapshot], { expect }) => {
		expect.assertions(1);

		const driver: ResourceDriver<"gamePass"> = trap;
		const registry = recoverCreates(registryWith({ gamePass: driver }), {
			environment: "production",
			progress: { emit: vi.fn<ProgressPort["emit"]>() },
			snapshot,
		});

		expect(registry.gamePass).toBe(driver);
	});

	it("should keep the Drivers of Kinds it cannot recover", ({ expect }) => {
		expect.assertions(1);

		const place: ResourceDriver<"place"> = {
			...trap,
			read: vi.fn<NonNullable<ResourceDriver<"place">["read"]>>(),
		};
		const registry = recoverCreates(registryWith({ place }), {
			environment: "production",
			progress: { emit: vi.fn<ProgressPort["emit"]>() },
			snapshot: {
				place: new Map([[placeCurrent().placeId, { kind: "place", outputs: {} }]]),
			},
		});

		expect(registry.place).toBe(place);
	});

	it("should pass the apply context to the wrapped create", async ({ expect }) => {
		expect.assertions(1);

		const driver = failing<"gamePass">(new Map());
		const registry = recoverCreates(registryWith({ gamePass: driver }), {
			environment: "production",
			progress: { emit: vi.fn<ProgressPort["emit"]>() },
			snapshot: { gamePass: new Map() },
		});
		const { outputs: _outputs, ...desired } = pass;
		const context = { artifact: new Uint8Array([1]) };
		await registry.gamePass.create(desired, context);

		expect(driver.create).toHaveBeenCalledExactlyOnceWith(desired, context);
	});

	it("should call the wrapped create without a context when Apply supplies none", async ({
		expect,
	}) => {
		expect.assertions(1);

		const driver = failing<"gamePass">(new Map());
		const registry = recoverCreates(registryWith({ gamePass: driver }), {
			environment: "production",
			progress: { emit: vi.fn<ProgressPort["emit"]>() },
			snapshot: { gamePass: new Map() },
		});
		const { outputs: _outputs, ...desired } = pass;
		await registry.gamePass.create(desired);

		expect(vi.mocked(driver.create).mock.calls).toStrictEqual([[desired]]);
	});

	it("should not recover the same item for a second failed create", async ({ expect }) => {
		expect.assertions(2);

		const { assetId, iconAssetIds } = pass.outputs;
		const driver = failing<"gamePass">(
			new Map([[assetId, { name: pass.name, kind: "gamePass", outputs: { iconAssetIds } }]]),
		);
		const registry = recoverCreates(registryWith({ gamePass: driver }), {
			environment: "production",
			progress: { emit: vi.fn<ProgressPort["emit"]>() },
			snapshot: { gamePass: new Map() },
		});
		const { outputs: _outputs, ...desired } = pass;

		await expect(registry.gamePass.create(desired)).resolves.toMatchObject({ success: true });
		await expect(registry.gamePass.create(desired)).resolves.toMatchObject({
			success: false,
		});
	});

	it("should not take an item an earlier create in the run recorded", async ({ expect }) => {
		expect.assertions(1);

		const { assetId, iconAssetIds } = pass.outputs;
		const answers: Array<Result<ResourceCurrentState<"gamePass">, OpenCloudError>> = [
			{ data: pass, success: true },
			{ err: UNAVAILABLE, success: false },
		];
		const driver: ResourceDriver<"gamePass"> = {
			create: async () => answers.shift()!,
			list: async () => {
				return {
					data: new Map([
						[assetId, { name: pass.name, kind: "gamePass", outputs: { iconAssetIds } }],
					]),
					success: true,
				};
			},
			retire: trap.retire,
		};
		const registry = recoverCreates(registryWith({ gamePass: driver }), {
			environment: "production",
			progress: { emit: vi.fn<ProgressPort["emit"]>() },
			snapshot: { gamePass: new Map() },
		});
		const { outputs: _outputs, ...desired } = pass;
		await registry.gamePass.create(desired);

		await expect(registry.gamePass.create(desired)).resolves.toStrictEqual({
			err: UNAVAILABLE,
			success: false,
		});
	});
});
