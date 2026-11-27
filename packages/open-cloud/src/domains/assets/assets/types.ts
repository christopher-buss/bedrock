/**
 * Moderation state of an asset. A new image starts as `Reviewing` and moves
 * to `Approved` or `Rejected`.
 *
 * @since unreleased
 */
export type ModerationState = "Approved" | "Rejected" | "Reviewing" | "Unspecified";

/**
 * An asset read from the Assets API.
 *
 * @since unreleased
 */
export interface Asset {
	/** Stringified ID of the asset. */
	readonly assetId: string;
	/** Where the asset is in moderation. */
	readonly moderationState: ModerationState;
}

/**
 * Parameters for reading an asset.
 *
 * @since unreleased
 */
export interface GetAssetParameters {
	/** Stringified ID of the asset to read. */
	readonly assetId: string;
}
