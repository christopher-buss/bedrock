import { describe, expect, it } from "vitest";

import { extractDisplayNamePrefix } from "./extract-display-name-prefix.ts";

describe(extractDisplayNamePrefix, () => {
	it("should capture the label and unprefixed body when input starts with a bracketed prefix", () => {
		expect.assertions(1);

		expect(extractDisplayNamePrefix("[DEV] My Game")).toStrictEqual({
			body: "My Game",
			label: "DEV",
		});
	});

	it("should preserve trailing whitespace in the body verbatim", () => {
		expect.assertions(1);

		expect(extractDisplayNamePrefix("[DEV] My Game  ")).toStrictEqual({
			body: "My Game  ",
			label: "DEV",
		});
	});

	it("should consume only the first bracket group when multiple brackets appear", () => {
		expect.assertions(1);

		expect(extractDisplayNamePrefix("[A] [B] X")).toStrictEqual({
			body: "[B] X",
			label: "A",
		});
	});

	it.for<[label: string, value: string]>([
		["plain string with no brackets", "My Game"],
		["empty brackets", "[] My Game"],
		["no whitespace after the closing bracket", "[DEV]X"],
		["only the bracketed label with no body", "[DEV] "],
		["leading content before the bracket", "prefix [DEV] X"],
	])("should pass through input with %s", ([, value]) => {
		expect.assertions(1);

		expect(extractDisplayNamePrefix(value)).toStrictEqual({
			body: value,
			label: undefined,
		});
	});
});
