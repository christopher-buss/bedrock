import type { ResourceKey } from "../types/ids.ts";
import type { Operation } from "./operations.ts";
import type { PlaceDesiredState, ResourceCurrentState } from "./resources.ts";

/** Inputs for {@link buildRepublishOps}. */
interface BuildRepublishOpsInputs {
	/** Post-asset-stage resources; supplies each place's `current` for an update op. */
	readonly currentResources: ReadonlyArray<ResourceCurrentState>;
	/** Declared places, the source of each republish op's desired state. */
	readonly desiredPlaces: ReadonlyArray<PlaceDesiredState>;
	/** Keys the rebuild hook actually rebuilt; only these places are republished. */
	readonly keys: ReadonlyArray<ResourceKey>;
}

/**
 * Build the place ops for a two-phase republish stage. Each declared place
 * named in `keys` becomes an `update` op (carrying its post-asset-stage
 * `current` and a `["rebuild"]` `changedFields` marking the forced republish)
 * when it already exists, or a `create` op when it does not. The rebuilt bytes
 * are not carried on the ops — they flow to the place driver as the republish
 * stage's per-key apply context.
 *
 * @param inputs - The rebuilt keys, declared places, and post-asset resources.
 * @returns One republish op per declared place named in `keys`.
 */
export function buildRepublishOps(inputs: BuildRepublishOpsInputs): ReadonlyArray<Operation> {
	const { currentResources, desiredPlaces, keys } = inputs;
	const rebuilt = new Set(keys);
	return desiredPlaces
		.filter((desired) => rebuilt.has(desired.key))
		.map((desired) => republishOp(desired, findPlaceCurrent(currentResources, desired.key)));
}

function findPlaceCurrent(
	currentResources: ReadonlyArray<ResourceCurrentState>,
	key: ResourceKey,
): ResourceCurrentState<"place"> | undefined {
	return currentResources.find((resource): resource is ResourceCurrentState<"place"> => {
		return resource.kind === "place" && resource.key === key;
	});
}

function republishOp(
	desired: PlaceDesiredState,
	current: ResourceCurrentState<"place"> | undefined,
): Operation {
	if (current === undefined) {
		return { key: desired.key, desired, type: "create" };
	}

	return { key: desired.key, changedFields: ["rebuild"], current, desired, type: "update" };
}
