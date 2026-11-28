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

/**
 * The user or group that owns a new asset.
 *
 * @since unreleased
 */
export type AssetCreator = { readonly groupId: string } | { readonly userId: string };

/**
 * Content type of an image file.
 *
 * @since unreleased
 */
export type ImageContentType = "image/bmp" | "image/jpeg" | "image/png" | "image/tga";

/**
 * Parameters for creating an `OpenUse` image asset, which any experience can
 * use, for example as a place icon.
 *
 * @since unreleased
 */
export interface CreateImageParameters {
	/** Content type of `fileContent`. */
	readonly contentType: ImageContentType;
	/** Owner of the new image. */
	readonly creator: AssetCreator;
	/** Description of the image. Defaults to an empty description. */
	readonly description?: string;
	/** Display name of the image. */
	readonly displayName: string;
	/** The image file. */
	readonly fileContent: Uint8Array;
}

/**
 * Parameters for setting or removing the source-language icon of an asset,
 * such as a place.
 *
 * @since unreleased
 */
export interface UpdateIconParameters {
	/** Stringified ID of the asset whose icon to set, such as a place ID. */
	readonly assetId: string;
	/**
	 * Stringified ID of an `OpenUse` image asset to set as the icon, or
	 * `undefined` to remove the icon.
	 */
	readonly iconAssetId: string | undefined;
}

/** Parameters for reading an asset operation. Internal to the subpath. */
export interface GetAssetOperationParameters {
	/** ID of the operation to read. */
	readonly operationId: string;
}
