/**
 * Parameters for updating the per-locale name and/or description registered
 * against a badge. Both `name` and `description` are optional; fields omitted
 * from the call are not included in the JSON body so the server leaves the
 * existing value for that locale untouched.
 */
export interface UpdateBadgeNameDescriptionParameters {
	/** Replacement display name for the supplied locale. */
	readonly name?: string;
	/** Stringified ID of the badge whose localization is being updated. */
	readonly badgeId: string;
	/** Replacement description for the supplied locale. */
	readonly description?: string;
	/** BCP-47 language code being updated (e.g. `fr-fr`). */
	readonly languageCode: string;
}
