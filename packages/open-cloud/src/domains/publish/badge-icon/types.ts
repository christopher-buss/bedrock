/**
 * Parameters for uploading or replacing the source-language icon
 * registered against a badge. A subsequent upload for the same badge
 * replaces the existing source icon; per-locale icon overlays live
 * under a separate `legacy-game-internationalization` endpoint and
 * are managed through `BadgesClient.localization.uploadIcon`.
 */
export interface UploadBadgeIconParameters {
	/** Stringified ID of the badge whose icon is being uploaded. */
	readonly badgeId: string;
	/** Image bytes to upload. PNG and JPEG are accepted by the server. */
	readonly icon: Blob | Uint8Array;
}
