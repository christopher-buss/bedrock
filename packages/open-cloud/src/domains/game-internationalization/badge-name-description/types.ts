import type { RobloxLanguageCode, RobloxLocale } from "#src/locales/data.generated";

/**
 * Parameters for updating the per-locale name and/or description registered
 * against a badge. Both `name` and `description` are optional; fields omitted
 * from the call are not included in the JSON body so the server leaves the
 * existing value for that locale untouched.
 *
 * @since 0.1.0
 */
export interface UpdateBadgeNameDescriptionParameters {
	/** Replacement display name for the supplied locale. */
	readonly name?: string;
	/** Stringified ID of the badge whose localization is being updated. */
	readonly badgeId: string;
	/** Replacement description for the supplied locale. */
	readonly description?: string;
	/**
	 * Roblox wire form being updated. Either the Language form (e.g.
	 * `en`, `fil`, `zh-hans`) or the Locale form (e.g. `en_us`, `pt_br`,
	 * `ar_001`).
	 */
	readonly languageCode: RobloxLanguageCode | RobloxLocale;
}
