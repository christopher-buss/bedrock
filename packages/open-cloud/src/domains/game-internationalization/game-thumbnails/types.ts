import type { RobloxLanguageCode, RobloxLocale } from "#src/locales/data.generated";

/**
 * Result of uploading a localized experience thumbnail.
 */
export interface UploadedExperienceThumbnail {
	/** Stringified media asset ID of the uploaded thumbnail. */
	readonly mediaAssetId: string;
}

/**
 * Parameters for uploading a new localized experience thumbnail. Each upload
 * appends a new entry to the carousel; reorder via {@link ReorderExperienceThumbnailsParameters}
 * after multiple uploads to set the display order.
 */
export interface UploadExperienceThumbnailParameters {
	/** Image bytes to upload. PNG and JPEG are accepted by the server. */
	readonly image: Blob | Uint8Array;
	/**
	 * Roblox wire form the thumbnail is being uploaded for. Either the
	 * Language form (e.g. `en`, `fil`, `zh-hans`) or the Locale form
	 * (e.g. `en_us`, `pt_br`, `ar_001`) -- not BCP-47.
	 */
	readonly languageCode: RobloxLanguageCode | RobloxLocale;
	/** Stringified ID of the universe whose carousel is being appended to. */
	readonly universeId: string;
}

/**
 * Parameters for deleting a single thumbnail by media asset ID.
 */
export interface DeleteExperienceThumbnailParameters {
	/** Stringified media asset ID of the thumbnail to delete. */
	readonly imageId: string;
	/**
	 * Roblox wire form of the thumbnail to delete. Either the Language
	 * form (e.g. `en`) or the Locale form (e.g. `en_us`) -- not BCP-47.
	 */
	readonly languageCode: RobloxLanguageCode | RobloxLocale;
	/** Stringified ID of the universe whose carousel is being modified. */
	readonly universeId: string;
}

/**
 * Parameters for reordering the localized thumbnail carousel. The supplied
 * `orderedImageIds` describes the new display order from first to last.
 */
export interface ReorderExperienceThumbnailsParameters {
	/**
	 * Roblox wire form of the carousel being reordered. Either the
	 * Language form (e.g. `en`) or the Locale form (e.g. `en_us`)
	 * -- not BCP-47.
	 */
	readonly languageCode: RobloxLanguageCode | RobloxLocale;
	/** Stringified media asset IDs in the desired display order. */
	readonly orderedImageIds: ReadonlyArray<string>;
	/** Stringified ID of the universe whose carousel is being reordered. */
	readonly universeId: string;
}
