import { describe, it } from "vitest";

import { isRobloxLocalizationKey } from "./localization-key.ts";

describe(isRobloxLocalizationKey, () => {
	it.for(["en_us", "pt_br", "en", "zh-hans"])(
		"should accept the Roblox key %s",
		(value, { expect }) => {
			expect.assertions(1);
			expect(isRobloxLocalizationKey(value)).toBeTrue();
		},
	);

	it.for(["en-us", "english", ""])("should reject the non-Roblox key %j", (value, { expect }) => {
		expect.assertions(1);
		expect(isRobloxLocalizationKey(value)).toBeFalse();
	});
});
