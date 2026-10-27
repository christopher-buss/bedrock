import type { ResourceCurrentState, ResourceKind } from "./resources.ts";

/**
 * Read the stored display name and Roblox identifier before ending management.
 *
 * @param current - Last-known state of the resource.
 * @returns Identity for previews and apply progress.
 */
export function currentResourceIdentity(
	current: ResourceCurrentState<Exclude<ResourceKind, "universe">>,
): { readonly name: string; readonly robloxId: string } {
	switch (current.kind) {
		case "developerProduct": {
			return { name: current.name, robloxId: current.outputs.productId };
		}
		case "gamePass": {
			return { name: current.name, robloxId: current.outputs.assetId };
		}
		case "place": {
			return { name: current.displayName ?? current.key, robloxId: current.placeId };
		}
	}
}
