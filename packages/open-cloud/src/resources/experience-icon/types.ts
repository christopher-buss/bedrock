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
	/** BCP-47 language code the icon is registered against (e.g. `en-us`). */
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
	/** BCP-47 language code the icon is being uploaded for (e.g. `en-us`). */
	readonly languageCode: string;
	/** Stringified ID of the universe whose icon is being uploaded. */
	readonly universeId: string;
}

/**
 * Parameters for deleting the localized icon registered against a universe
 * for a given language.
 */
export interface DeleteExperienceIconParameters {
	/** BCP-47 language code of the icon to delete. */
	readonly languageCode: string;
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
