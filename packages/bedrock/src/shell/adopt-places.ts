import type { Result } from "@bedrock-rbx/ocale";

import { adoptablePlaces, adoptedPlace } from "../core/adopt-place.ts";
import { flattenConfig } from "../core/flatten.ts";
import type { ResourceCurrentState, ResourceKind } from "../core/resources.ts";
import type { ResourceKey, RobloxAssetId } from "../types/ids.ts";
import type { ImportError, ImportInputs } from "./import-live.ts";

/** A live item recorded as Current state by an import or a place adoption. */
export interface ImportedResource {
	/** Config Key the item is recorded under. */
	readonly key: ResourceKey;
	/** Kind of the item. */
	readonly kind: ResourceKind;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
}

/** A place recorded as Current state by its adoption. */
export interface AdoptedPlace {
	/** The live place as Current state. */
	readonly current: ResourceCurrentState;
	/** What was adopted. */
	readonly imported: ImportedResource;
}

/**
 * Adopt each config-only place that saved State does not track yet: read it
 * by its `placeId` and record its live metadata as Current state, so the
 * first deploy writes only the fields config changes. A place that is not
 * live, or a run without a place reader, is left to the normal plan.
 *
 * @param inputs - Config and Drivers.
 * @param resources - Saved Current state of the Environment.
 * @returns The adopted places, or why a read failed.
 */
export async function adoptPlacesAsync(
	inputs: ImportInputs,
	resources: ReadonlyArray<ResourceCurrentState>,
): Promise<Result<ReadonlyArray<AdoptedPlace>, ImportError>> {
	const driver = inputs.registry?.place;
	if (driver?.read === undefined) {
		return { data: [], success: true };
	}

	const places = adoptablePlaces(flattenConfig(inputs.config), resources);
	const adopted: Array<AdoptedPlace> = [];
	for (const place of places) {
		const live = await driver.read(place.placeId);
		if (!live.success) {
			return {
				err: { cause: live.err, kind: "liveCheckFailed", resourceKind: "place" },
				success: false,
			};
		}

		if (live.data !== undefined) {
			adopted.push({
				current: adoptedPlace(place, live.data),
				imported: { key: place.key, kind: "place", robloxId: place.placeId },
			});
		}
	}

	return { data: adopted, success: true };
}
