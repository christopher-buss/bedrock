import { describe, expect, it } from "vitest";

import { asResourceKey } from "./ids.ts";

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
