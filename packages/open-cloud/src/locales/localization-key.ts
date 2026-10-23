import {
	ROBLOX_CREATOR_LOCALES,
	type RobloxLanguageCode,
	type RobloxLocale,
} from "./data.generated.ts";

/**
 * Any string Roblox accepts as a localization key: an underscore locale such
 * as `en_us`, or a language code such as `en` or `zh-hans`.
 *
 * @since unreleased
 */
export type RobloxLocalizationKey = RobloxLanguageCode | RobloxLocale;

const LOCALIZATION_KEYS: ReadonlySet<string> = new Set(
	ROBLOX_CREATOR_LOCALES.flatMap((row) => [row.locale, row.languageCode]),
);

/**
 * Checks whether a string is a Roblox localization key, narrowing it to
 * {@link RobloxLocalizationKey}. Region-qualified hyphen forms such as
 * `en-us` are rejected (Roblox writes them as `en_us`), as are language names
 * such as `english`.
 *
 * @since unreleased
 * @param value - The string to check.
 * @returns `true` when `value` is a known locale or language code.
 * @example
 * ```ts
 * import { isRobloxLocalizationKey } from "@bedrock-rbx/ocale/locales";
 *
 * expect(isRobloxLocalizationKey("pt_br")).toBe(true);
 * expect(isRobloxLocalizationKey("en-us")).toBe(false);
 * ```
 */
export function isRobloxLocalizationKey(value: string): value is RobloxLocalizationKey {
	return LOCALIZATION_KEYS.has(value);
}
