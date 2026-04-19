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
 * @param deps - Injected ocale client, file reader, and owning universe.
 * @returns A driver indexable by `"gamePass"` in a `DriverRegistry`.
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
