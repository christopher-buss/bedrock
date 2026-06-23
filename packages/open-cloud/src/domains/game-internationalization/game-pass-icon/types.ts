import type { RobloxLanguageCode, RobloxLocale } from "#src/locales/data.generated";

/**
 * Parameters for uploading or replacing the per-locale icon registered
 * against a game pass. A subsequent upload for the same
 * `(gamePassId, languageCode)` pair replaces the existing icon for that
 * locale.
 *
 * @since 0.1.0
 */
export interface UploadGamePassIconParameters {
	/** Stringified ID of the game pass whose icon is being uploaded. */
	readonly gamePassId: string;
	/** Image bytes to upload. PNG and JPEG are accepted by the server. */
	readonly image: Blob | Uint8Array;
	/**
	 * Roblox wire form the icon is being uploaded for. Either the
	 * Language form (e.g. `en`, `fil`, `zh-hans`) or the Locale form
	 * (e.g. `en_us`, `pt_br`, `ar_001`).
	 */
	readonly languageCode: RobloxLanguageCode | RobloxLocale;
}
