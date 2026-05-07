/**
 * Parameters for updating the per-locale name and/or description registered
 * against a game pass. Both `name` and `description` are optional; fields
 * omitted from the call are not included in the JSON body so the server
 * leaves the existing value for that locale untouched.
 */
export interface UpdateGamePassNameDescriptionParameters {
	/** Replacement display name for the supplied locale. */
	readonly name?: string;
	/** Replacement description for the supplied locale. */
	readonly description?: string;
	/** Stringified ID of the game pass whose localization is being updated. */
	readonly gamePassId: string;
	/** BCP-47 language code being updated (e.g. `fr-fr`). */
	readonly languageCode: string;
}
