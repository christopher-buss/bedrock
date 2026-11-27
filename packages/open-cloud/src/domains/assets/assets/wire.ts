// Mirrors AssetsUploadApi.Asset from vendor/roblox-openapi.json.
// Internal to the subpath, not re-exported from index.ts. Only the fields
// the parsers read are modelled.

import type { ModerationState } from "./types.ts";

/** Wire shape of the asset fields the parsers read. */
export interface AssetWire {
	/** Stringified ID of the asset. */
	readonly assetId: string;
	/** Moderation result of the asset. */
	readonly moderationResult: {
		/** The moderation state. */
		readonly moderationState: ModerationState;
	};
}
