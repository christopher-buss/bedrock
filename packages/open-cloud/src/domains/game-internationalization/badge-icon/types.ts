/**
 * Parameters for uploading or replacing the per-locale icon registered
 * against a badge. A subsequent upload for the same `(badgeId, languageCode)`
 * pair replaces the existing icon for that locale. Source-language icons
 * are managed through `BadgesClient.uploadIcon`.
 */
export interface UploadBadgeIconLocalizationParameters {
	/** Stringified ID of the badge whose icon is being uploaded. */
	readonly badgeId: string;
	/** Image bytes to upload. PNG and JPEG are accepted by the server. */
	readonly image: Blob | Uint8Array;
	/** BCP-47 language code the icon is being uploaded for (e.g. `fr-fr`). */
	readonly languageCode: string;
}
