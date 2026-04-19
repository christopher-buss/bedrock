import { ApiError, type Result } from "@bedrock/ocale";
import type { GamePass, GamePassesClient } from "@bedrock/ocale/game-passes";

import type { GamePassDesiredState, ResourceCurrentState } from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";

/**
 * `universeId` is captured at construction time rather than on
 * `GamePassDesiredState` so state files round-trip with Mantle's `PassInputs`
 * shape. `readFile` exists on the driver (not upstream in shell) because icon
 * hashes flow through `diff` but bytes do not.
 */
export interface GamePassDriverDeps {
	/** Configured game-passes client from `@bedrock/ocale/game-passes`. */
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
 * import { GamePassesClient } from "@bedrock/ocale/game-passes";
 * import { asRobloxAssetId, createGamePassDriver } from "bedrock";
 *
 * const client = new GamePassesClient({ apiKey: "rbx-your-key" });
 * const driver = createGamePassDriver({
 *     client,
 *     readFile: async () => new Uint8Array(),
 *     universeId: asRobloxAssetId("1234567890"),
 * });
 *
 * expect(driver.create).toBeFunction();
 * ```
 */
export function createGamePassDriver(deps: GamePassDriverDeps): ResourceDriver<"gamePass"> {
	return {
		async create(desired) {
			const imageFile = await deps.readFile(desired.iconFilePath);
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
		},
	};
}

function toCurrentState(
	desired: GamePassDesiredState,
	data: GamePass,
): Result<ResourceCurrentState, ApiError> {
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
				iconAssetId: asRobloxAssetId(iconAssetId),
			},
		},
		success: true,
	};
}
