import type { RobloxLanguageCode, RobloxLocale } from "#src/locales/data.generated";

import type { GameIconState } from "./wire.ts";

export type { GameIconState } from "./wire.ts";

/**
 * A localized icon entry returned by listing icons for an experience.
 */
export interface ExperienceIcon {
	/** Stringified ID of the uploaded icon image. */
	readonly imageId: string;
	/** CDN URL the icon can be loaded from. */
	readonly imageUrl: string;
	/**
	 * Roblox wire form the icon is registered against -- the Language
	 * form (e.g. `en`, `fil`, `zh-hans`) or the Locale form (e.g.
	 * `en_us`, `pt_br`, `ar_001`), not BCP-47. Typed as `string` rather
	 * than the locale union because the API can return entries for
	 * locales added after our last vendor refresh.
	 */
	readonly languageCode: string;
	/** Moderation state of the icon. */
	readonly state: GameIconState;
}

/**
 * Parameters for uploading or replacing a localized experience icon. A
 * subsequent upload for the same `(universeId, languageCode)` pair replaces
 * the existing icon for that locale.
 */
export interface UploadExperienceIconParameters {
	/** Image bytes to upload. PNG and JPEG are accepted by the server. */
	readonly image: Blob | Uint8Array;
	/**
	 * Roblox wire form the icon is being uploaded for. Either the
	 * Language form (e.g. `en`, `fil`, `zh-hans`) or the Locale form
	 * (e.g. `en_us`, `pt_br`, `ar_001`) -- not BCP-47. The endpoint
	 * rejects any other shape with `code 22` (Invalid language code).
	 */
	readonly languageCode: RobloxLanguageCode | RobloxLocale;
	/** Stringified ID of the universe whose icon is being uploaded. */
	readonly universeId: string;
}

/**
 * Parameters for deleting the localized icon registered against a universe
 * for a given language.
 */
export interface DeleteExperienceIconParameters {
	/**
	 * Roblox wire form of the icon to delete. Either the Language form
	 * (e.g. `en`, `fil`, `zh-hans`) or the Locale form (e.g. `en_us`,
	 * `pt_br`, `ar_001`) -- not BCP-47.
	 */
	readonly languageCode: RobloxLanguageCode | RobloxLocale;
	/** Stringified ID of the universe whose icon is being deleted. */
	readonly universeId: string;
}

/**
 * Parameters for listing every localized icon registered against a universe.
 */
export interface ListExperienceIconsParameters {
	/** Stringified ID of the universe whose icons are being listed. */
	readonly universeId: string;
}
