import type { RobloxAssetId } from "../types/ids.ts";
import type { ImportItemKind } from "./import-plan-types.ts";
import type { ResourceLiveState } from "./live-state.ts";

type ImportLive = ResourceLiveState<ImportItemKind>;

/**
 * Asset ID of the stored icon of a live item.
 *
 * @param live - Live state of the item.
 * @returns The asset ID, or `undefined` for the Roblox default image.
 */
export function storedIcon(live: ImportLive): RobloxAssetId | undefined {
	switch (live.kind) {
		case "badge": {
			return live.outputs.iconImageId;
		}
		case "developerProduct": {
			return live.outputs.iconImageAssetId;
		}
		case "gamePass": {
			return live.outputs.iconAssetIds?.["en-us"];
		}
		case "place": {
			return undefined;
		}
	}
}

/**
 * Name of a live item as Roblox shows it: a place's display name, or the
 * item's name.
 *
 * @param live - Live state of the item.
 * @returns The name, or `""` when Roblox reported none.
 */
export function liveName(live: ImportLive): string {
	return (live.kind === "place" ? live.displayName : live.name) ?? "";
}
