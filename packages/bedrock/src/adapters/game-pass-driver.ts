import { ApiError, type OpenCloudError, type Result } from "@bedrock-rbx/ocale";
import type { GamePass, GamePassesClient } from "@bedrock-rbx/ocale/game-passes";

import { derivePriceFields } from "../core/derive-price-fields.ts";
import { shouldReuploadIcon } from "../core/icons.ts";
import { withRedactedIcon } from "../core/redacted-icon.ts";
import type { GamePassDesiredState, ResourceCurrentState } from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";

/**
 * `universeId` is captured at construction time rather than on
 * `GamePassDesiredState` so state files round-trip with Mantle's `PassInputs`
 * shape. `readFile` exists on the driver (not upstream in shell) because icon
 * hashes flow through `diff` but bytes do not.
 *
 * @example
 *
 * ```ts
 * import type { HttpClient } from "@bedrock-rbx/ocale";
 * import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
 * import { asRobloxAssetId, type GamePassDriverDeps } from "@bedrock-rbx/core";
 *
 * const httpClient: HttpClient = {
 *     async request() {
 *         return { data: { body: {}, headers: {}, status: 200 }, success: true };
 *     },
 * };
 *
 * const deps: GamePassDriverDeps = {
 *     client: new GamePassesClient({
 *         apiKey: "rbx-your-key",
 *         httpClient,
 *         sleep: async () => {},
 *     }),
 *     readFile: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
 *     universeId: asRobloxAssetId("1234567890"),
 * };
 *
 * expect(deps.universeId).toBe("1234567890");
 * ```
 */
export interface GamePassDriverDeps {
	/** Configured game-passes client from `@bedrock-rbx/ocale/game-passes`. */
	readonly client: GamePassesClient;
	/** Reads icon bytes for upload; rejections propagate out of `create`. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Universe that owns every game pass this driver creates. */
	readonly universeId: RobloxAssetId;
}

/**
 * Wraps {@link GamePassesClient} as a `ResourceDriver<"gamePass">` that maps
 * a desired-state entry to an ocale create call and the response back to a
 * `ResourceCurrentState<"gamePass">`.
 *
 * Upstream `OpenCloudError` results pass through as `Result` failures.
 * Filesystem errors from `deps.readFile` do not fit the `OpenCloudError`
 * shape and propagate as promise rejections; shell callers are expected to
 * translate them if a unified error surface is required.
 *
 * @param deps - Injected ocale client, file reader, and owning universe.
 * @returns A driver indexable by `"gamePass"` in a `DriverRegistry`.
 * @throws Whatever `deps.readFile` rejects with.
 *
 * @example
 *
 * ```ts
 * import type { HttpClient } from "@bedrock-rbx/ocale";
 * import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     createGamePassDriver,
 * } from "@bedrock-rbx/core";
 *
 * const httpClient: HttpClient = {
 *     async request() {
 *         return {
 *             data: {
 *                 body: {
 *                     createdTimestamp: "2024-01-15T10:30:00.000Z",
 *                     description: "Grants VIP perks.",
 *                     gamePassId: 9_876_543_210,
 *                     iconAssetId: 1_122_334_455,
 *                     isForSale: true,
 *                     name: "VIP Pass",
 *                     updatedTimestamp: "2024-01-15T10:30:00.000Z",
 *                 },
 *                 headers: {},
 *                 status: 200,
 *             },
 *             success: true,
 *         };
 *     },
 * };
 *
 * const driver = createGamePassDriver({
 *     client: new GamePassesClient({
 *         apiKey: "rbx-your-key",
 *         httpClient,
 *         sleep: async () => {},
 *     }),
 *     readFile: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
 *     universeId: asRobloxAssetId("1234567890"),
 * });
 *
 * return driver
 *     .create({
 *         description: "Grants VIP perks.",
 *         icon: { "en-us": "assets/vip-icon.png" },
 *         iconFileHashes: {
 *             "en-us": asSha256Hex(
 *                 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *             ),
 *         },
 *         key: asResourceKey("vip-pass"),
 *         kind: "gamePass",
 *         name: "VIP Pass",
 *         price: 500,
 *     })
 *     .then((result) => {
 *         expect(result.success).toBeTrue();
 *         if (result.success) {
 *             expect(result.data.outputs.assetId).toBe("9876543210");
 *         }
 *     });
 * ```
 */
export function createGamePassDriver(deps: GamePassDriverDeps): ResourceDriver<"gamePass"> {
	const effective: GamePassDriverDeps = {
		...deps,
		readFile: withRedactedIcon(deps.readFile),
	};
	return {
		async create(desired) {
			return createGamePass(effective, desired);
		},
		async update(current, desired) {
			return updateGamePass(effective, { current, desired });
		},
	};
}

function toCurrentState(
	desired: GamePassDesiredState,
	data: GamePass,
): Result<ResourceCurrentState<"gamePass">, OpenCloudError> {
	const { id, iconAssetId } = data;
	if (iconAssetId === undefined) {
		return {
			err: new ApiError(
				"Malformed game pass response: iconAssetId missing after icon upload",
				{ statusCode: 200 },
			),
			success: false,
		};
	}

	return {
		data: {
			...desired,
			outputs: {
				assetId: asRobloxAssetId(id),
				iconAssetIds: { "en-us": asRobloxAssetId(iconAssetId) },
			},
		},
		success: true,
	};
}

async function createGamePass(
	deps: GamePassDriverDeps,
	desired: GamePassDesiredState,
): Promise<Result<ResourceCurrentState<"gamePass">, OpenCloudError>> {
	const imageFile = await deps.readFile(desired.icon["en-us"]);
	const result = await deps.client.create({
		name: desired.name,
		description: desired.description,
		imageFile,
		universeId: deps.universeId,
		...(desired.price !== undefined ? { price: desired.price } : {}),
	});
	if (!result.success) {
		return result;
	}

	return toCurrentState(desired, result.data);
}

async function resolveUpdatedState(
	deps: GamePassDriverDeps,
	context: {
		readonly current: ResourceCurrentState<"gamePass">;
		readonly desired: GamePassDesiredState;
		readonly hasIconChanged: boolean;
	},
): Promise<Result<ResourceCurrentState<"gamePass">, OpenCloudError>> {
	const { current, desired, hasIconChanged } = context;
	if (!hasIconChanged) {
		return { data: { ...desired, outputs: current.outputs }, success: true };
	}

	const fetched = await deps.client.get({
		gamePassId: current.outputs.assetId,
		universeId: deps.universeId,
	});
	if (!fetched.success) {
		return fetched;
	}

	return toCurrentState(desired, fetched.data);
}

async function updateGamePass(
	deps: GamePassDriverDeps,
	states: {
		readonly current: ResourceCurrentState<"gamePass">;
		readonly desired: GamePassDesiredState;
	},
): Promise<Result<ResourceCurrentState<"gamePass">, OpenCloudError>> {
	const { current, desired } = states;
	const hasIconChanged = shouldReuploadIcon(current.iconFileHashes, desired.iconFileHashes);
	const imageFile = hasIconChanged ? await deps.readFile(desired.icon["en-us"]) : undefined;

	const result = await deps.client.update({
		name: desired.name,
		description: desired.description,
		gamePassId: current.outputs.assetId,
		universeId: deps.universeId,
		...derivePriceFields(desired),
		...(imageFile !== undefined ? { imageFile } : {}),
	});
	if (!result.success) {
		return result;
	}

	return resolveUpdatedState(deps, { current, desired, hasIconChanged });
}
