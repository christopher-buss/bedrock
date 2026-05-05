/**
 * Parameters for uploading or replacing the per-locale icon registered
 * against a developer product. A subsequent upload for the same
 * `(productId, languageCode)` pair replaces the existing icon for that
 * locale.
 */
export interface UploadDeveloperProductIconParameters {
	/** Image bytes to upload. PNG and JPEG are accepted by the server. */
	readonly image: Blob | Uint8Array;
	/** BCP-47 language code the icon is being uploaded for (e.g. `fr-fr`). */
	readonly languageCode: string;
	/** Stringified ID of the developer product whose icon is being uploaded. */
	readonly productId: string;
}
