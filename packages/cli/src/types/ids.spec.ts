import { describe, expect, it } from "vitest";

import {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	isResourceKey,
	isRobloxAssetId,
	isSha256Hex,
} from "./ids.ts";

describe(isResourceKey, () => {
	it.for<[label: string, input: string]>([
		["empty string", ""],
		["single space", " "],
		["embedded space", "has space"],
		["forward slash", "has/slash"],
		["dot", "has.dot"],
	])("should return false for a %s", ([, input]) => {
		expect.assertions(1);

		expect(isResourceKey(input)).toBeFalse();
	});

	it.for<[input: string]>([["vip-pass"], ["VIP_Pass_2"], ["a"], ["A1_b-2"]])(
		"should return true for %s",
		([input]) => {
			expect.assertions(1);

			expect(isResourceKey(input)).toBeTrue();
		},
	);
});

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

const VALID_SHA256 = "a".repeat(64);
const SHA256_63 = "a".repeat(63);
const SHA256_65 = "a".repeat(65);
const SHA256_UPPER = "A".repeat(64);
const SHA256_WITH_NON_HEX = `${"a".repeat(63)}g`;

describe(isSha256Hex, () => {
	it.for<[label: string, input: string]>([
		["empty string", ""],
		["63-char hex", SHA256_63],
		["65-char hex", SHA256_65],
		["uppercase 64-char", SHA256_UPPER],
		["64-char with non-hex letter", SHA256_WITH_NON_HEX],
	])("should return false for a %s", ([, input]) => {
		expect.assertions(1);

		expect(isSha256Hex(input)).toBeFalse();
	});

	it("should return true for a valid 64-char lowercase hex digest", () => {
		expect.assertions(1);

		expect(isSha256Hex(VALID_SHA256)).toBeTrue();
	});
});

describe(asSha256Hex, () => {
	it.for<[label: string, input: string]>([
		["empty string", ""],
		["63-char hex", SHA256_63],
		["65-char hex", SHA256_65],
		["uppercase 64-char", SHA256_UPPER],
		["64-char with non-hex letter", SHA256_WITH_NON_HEX],
	])("should reject a %s", ([, input]) => {
		expect.assertions(1);

		expect(() => asSha256Hex(input)).toThrowWithMessage(
			RangeError,
			/^Sha256Hex must be 64 lowercase hex characters/,
		);
	});

	it("should accept a valid 64-char lowercase hex digest", () => {
		expect.assertions(1);

		expect(asSha256Hex(VALID_SHA256)).toBe(VALID_SHA256);
	});
});
