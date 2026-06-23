import type { RobloxLanguageCode, RobloxLocale } from "#src/locales/data.generated";

/**
 * Parameters for uploading or replacing the per-locale icon registered
 * against a badge. A subsequent upload for the same `(badgeId, languageCode)`
 * pair replaces the existing icon for that locale. Source-language icons
 * are managed through `BadgesClient.uploadIcon`.
 *
 * @since 0.1.0
 */
export interface UploadBadgeIconLocalizationParameters {
	/** Stringified ID of the badge whose icon is being uploaded. */
	readonly badgeId: string;
	/** Image bytes to upload. PNG and JPEG are accepted by the server. */
	readonly image: Blob | Uint8Array;
	/**
	 * Roblox wire form the icon is being uploaded for. Either the
	 * Language form (e.g. `en`, `fil`, `zh-hans`) or the Locale form
	 * (e.g. `en_us`, `pt_br`, `ar_001`).
	 */
	readonly languageCode: RobloxLanguageCode | RobloxLocale;
}
