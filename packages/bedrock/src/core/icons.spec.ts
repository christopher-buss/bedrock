import { describe, expect, it } from "vitest";

import { asSha256Hex } from "../types/ids.ts";
import { iconHashesEqual } from "./icons.ts";

const HASH_A = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
const HASH_B = asSha256Hex("2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");

describe(iconHashesEqual, () => {
	it("should return true when both sides are undefined", () => {
		expect.assertions(1);

		expect(iconHashesEqual(undefined, undefined)).toBeTrue();
	});

	it("should return false when desired is undefined and current is present", () => {
		expect.assertions(1);

		expect(iconHashesEqual(undefined, { "en-us": HASH_A })).toBeFalse();
	});

	it("should return false when current is undefined and desired is present", () => {
		expect.assertions(1);

		expect(iconHashesEqual({ "en-us": HASH_A }, undefined)).toBeFalse();
	});

	it("should return true when both sides carry the same en-us hash", () => {
		expect.assertions(1);

		expect(iconHashesEqual({ "en-us": HASH_A }, { "en-us": HASH_A })).toBeTrue();
	});

	it("should return false when the en-us hash differs across sides", () => {
		expect.assertions(1);

		expect(iconHashesEqual({ "en-us": HASH_A }, { "en-us": HASH_B })).toBeFalse();
	});
});
