import type { PlaceDesiredInput, ResourceDesiredInput } from "./flatten.ts";
import type { ResourceLiveState } from "./live-state.ts";
import type { PlaceDesiredState, ResourceCurrentState } from "./resources.ts";

/**
 * Config-only places that no saved Current state tracks yet, by Key or by
 * place ID. A place is adopted by its `placeId`, so its first deploy reads
 * it instead of creating it.
 *
 * @param inputs - Flattened config of the Environment.
 * @param resources - Saved Current state of the Environment.
 * @returns Desired state of the places to adopt, in config order.
 */
export function adoptablePlaces(
	inputs: ReadonlyArray<ResourceDesiredInput>,
	resources: ReadonlyArray<ResourceCurrentState>,
): ReadonlyArray<PlaceDesiredState> {
	const saved = resources.filter((resource): resource is ResourceCurrentState<"place"> => {
		return resource.kind === "place";
	});
	const keys = new Set<string>(saved.map(({ key }) => key));
	const placeIds = new Set<string>(saved.map(({ placeId }) => placeId));
	return inputs
		.filter((input): input is PlaceDesiredInput => {
			return (
				input.kind === "place" &&
				!("retired" in input) &&
				input.filePath === undefined &&
				!keys.has(input.key) &&
				!placeIds.has(input.placeId)
			);
		})
		.map(({ key, description, displayName, placeId, serverSize }) => {
			return {
				key,
				description,
				displayName,
				fileHash: undefined,
				filePath: undefined,
				kind: "place",
				placeId,
				serverSize,
			};
		});
}

/**
 * Record a live place as the Current state of the Key that adopts it. Live
 * metadata replaces config values, so the Diff that follows plans only the
 * fields that differ.
 *
 * @param desired - Desired state of the adopting Key.
 * @param live - Live state read from Roblox.
 * @returns The adopted Current state, with no published version.
 */
export function adoptedPlace(
	desired: PlaceDesiredState,
	live: ResourceLiveState<"place">,
): ResourceCurrentState<"place"> {
	return {
		...desired,
		description: live.description,
		displayName: live.displayName,
		outputs: { versionNumber: undefined },
		serverSize: live.serverSize,
	};
}
