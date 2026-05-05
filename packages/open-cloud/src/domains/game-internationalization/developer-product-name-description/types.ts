/**
 * Parameters for updating the per-locale name and/or description registered
 * against a developer product. Both `name` and `description` are optional;
 * fields omitted from the call are not included in the JSON body so the
 * server leaves the existing value for that locale untouched.
 */
export interface UpdateDeveloperProductNameDescriptionParameters {
	/** Replacement display name for the supplied locale. */
	readonly name?: string;
	/** Replacement description for the supplied locale. */
	readonly description?: string;
	/** BCP-47 language code being updated (e.g. `fr-fr`). */
	readonly languageCode: string;
	/** Stringified ID of the developer product whose localization is being updated. */
	readonly productId: string;
}
