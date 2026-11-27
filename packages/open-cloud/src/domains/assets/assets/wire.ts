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

/** The error of a failed asset operation, from `AssetsUploadApi.Status`. */
export interface AssetOperationStatus {
	/** The error code, when the server sent one. */
	readonly code: string | undefined;
	/** The error message, when the server sent one. */
	readonly message: string | undefined;
}

/** A parsed `AssetsUploadApi.Operation`. */
export interface AssetOperation {
	/** Whether the operation has finished. An absent flag reads as `false`. */
	readonly done: boolean;
	/** The error of a failed operation. */
	readonly error: AssetOperationStatus | undefined;
	/** ID of the operation. */
	readonly operationId: string;
	/** The asset the operation produced, unparsed. Absent until done. */
	readonly response: unknown;
}
