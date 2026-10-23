import { describe, expectTypeOf, it } from "vitest";

import type { RobloxLanguageCode, RobloxLocale, RobloxLocalizationKey } from "./index.ts";
import { isRobloxLocalizationKey } from "./index.ts";

describe("RobloxLocalizationKey", () => {
	it("should be the union of locales and language codes", () => {
		expectTypeOf<RobloxLocalizationKey>().toEqualTypeOf<RobloxLanguageCode | RobloxLocale>();
	});
});

describe(isRobloxLocalizationKey, () => {
	it("should accept a string and narrow it to RobloxLocalizationKey", () => {
		expectTypeOf(isRobloxLocalizationKey).parameters.toEqualTypeOf<[string]>();
		expectTypeOf(isRobloxLocalizationKey).guards.toEqualTypeOf<RobloxLocalizationKey>();
	});
});
