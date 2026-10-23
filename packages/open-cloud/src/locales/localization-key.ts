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
 * @example
 * ```ts
 * import type { RobloxLocalizationKey } from "@bedrock-rbx/ocale/locales";
 *
 * const keys = ["en_us", "zh-hans"] satisfies Array<RobloxLocalizationKey>;
 * expect(keys).toHaveLength(2);
 * ```
 */
export type RobloxLocalizationKey = RobloxLanguageCode | RobloxLocale;

const LOCALIZATION_KEYS: ReadonlySet<string> = new Set(
	ROBLOX_CREATOR_LOCALES.flatMap((row) => [row.locale, row.languageCode]),
);

/**
 * Checks whether a string is a Roblox localization key, narrowing it to
 * {@link RobloxLocalizationKey}. BCP-47 hyphen forms such as `en-us` and
 * language names such as `english` are rejected.
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
