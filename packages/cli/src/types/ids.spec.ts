import { describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, isRobloxAssetId } from "./ids.ts";

describe(asResourceKey, () => {
	it.for<[label: string, input: string]>([
		["empty string", ""],
		["single space", " "],
		["embedded space", "has space"],
		["forward slash", "has/slash"],
		["dot", "has.dot"],
	])("should reject a %s", ([, input]) => {
		expect.assertions(1);

		expect(() => asResourceKey(input)).toThrowWithMessage(
			RangeError,
			/^ResourceKey must match/,
		);
	});

	it.for<[input: string]>([["vip-pass"], ["VIP_Pass_2"], ["a"], ["A1_b-2"]])(
		"should accept %s",
		([input]) => {
			expect.assertions(1);

			expect(asResourceKey(input)).toBe(input);
		},
	);
});

describe(isRobloxAssetId, () => {
	it.for<[label: string, input: string]>([
		["empty string", ""],
		["alphabetic", "abc"],
		["digits with trailing letters", "123abc"],
		["decimal point", "12.3"],
		["leading sign", "+1"],
	])("should return false for a %s", ([, input]) => {
		expect.assertions(1);

		expect(isRobloxAssetId(input)).toBeFalse();
	});

	it.for<[input: string]>([["1"], ["12345"], ["9007199254740993"]])(
		"should return true for %s",
		([input]) => {
			expect.assertions(1);

			expect(isRobloxAssetId(input)).toBeTrue();
		},
	);
});

describe(asRobloxAssetId, () => {
	it.for<[label: string, input: string]>([
		["empty string", ""],
		["alphabetic", "abc"],
		["digits with trailing letters", "123abc"],
		["decimal point", "12.3"],
		["leading sign", "+1"],
	])("should reject a %s", ([, input]) => {
		expect.assertions(1);

		expect(() => asRobloxAssetId(input)).toThrowWithMessage(
			RangeError,
			/^RobloxAssetId must be a non-empty digit-only string/,
		);
	});

	it.for<[input: string]>([["1"], ["12345"], ["9007199254740993"]])(
		"should accept %s",
		([input]) => {
			expect.assertions(1);

			expect(asRobloxAssetId(input)).toBe(input);
		},
	);
});
