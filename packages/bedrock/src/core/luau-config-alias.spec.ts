import { describe, it } from "vitest";

import {
	configLuauAliasSnippet,
	decideLuauAlias,
	detectLuauConfigFormat,
} from "./luau-config-alias.ts";

const WANTED = { alias: "bedrock", target: ".bedrock/" };

describe(detectLuauConfigFormat, () => {
	it.for([
		{ configLuauExists: false, expected: "luaurc", luaurcExists: false },
		{ configLuauExists: false, expected: "luaurc", luaurcExists: true },
		{ configLuauExists: true, expected: "configLuau", luaurcExists: false },
	])(
		"should pick $expected when .luaurc exists is $luaurcExists and .config.luau exists is $configLuauExists",
		({ configLuauExists, expected, luaurcExists }, { expect }) => {
			expect.assertions(1);

			expect(detectLuauConfigFormat({ configLuauExists, luaurcExists })).toStrictEqual({
				data: expected,
				success: true,
			});
		},
	);

	it("should refuse a directory holding both config formats", ({ expect }) => {
		expect.assertions(1);

		expect(
			detectLuauConfigFormat({ configLuauExists: true, luaurcExists: true }),
		).toStrictEqual({ err: { kind: "conflictingLuauConfigs" }, success: false });
	});
});

describe(decideLuauAlias, () => {
	it("should set an alias that is absent", ({ expect }) => {
		expect.assertions(1);

		expect(decideLuauAlias({ pkg: "Packages" }, WANTED)).toStrictEqual({
			data: "set",
			success: true,
		});
	});

	it("should leave an alias that already points at the target, ignoring ./ and trailing /", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(decideLuauAlias({ bedrock: "./.bedrock//" }, WANTED)).toStrictEqual({
			data: "unchanged",
			success: true,
		});
	});

	it("should set an alias that still holds the target it replaces", ({ expect }) => {
		expect.assertions(1);

		expect(
			decideLuauAlias({ bedrock: "./old/" }, { ...WANTED, replaces: "old" }),
		).toStrictEqual({ data: "set", success: true });
	});

	it("should report a conflict when the alias points elsewhere", ({ expect }) => {
		expect.assertions(1);

		expect(
			decideLuauAlias({ bedrock: "other/" }, { ...WANTED, replaces: "old/" }),
		).toStrictEqual({
			err: { alias: "bedrock", existingTarget: "other/", kind: "aliasConflict" },
			success: false,
		});
	});

	it("should report an alias that does not hold a string path", ({ expect }) => {
		expect.assertions(1);

		expect(decideLuauAlias({ bedrock: false }, { ...WANTED, replaces: "old/" })).toStrictEqual({
			err: { alias: "bedrock", kind: "aliasNotString" },
			success: false,
		});
	});
});

describe(configLuauAliasSnippet, () => {
	it("should show the alias nested under luau.aliases", ({ expect }) => {
		expect.assertions(1);

		expect(configLuauAliasSnippet({ alias: "my-types", target: ".bedrock/" })).toBe(
			'luau = {\n\taliases = {\n\t\t["my-types"] = ".bedrock/",\n\t},\n},',
		);
	});

	it("should write an identifier alias as a bare key", ({ expect }) => {
		expect.assertions(1);

		expect(configLuauAliasSnippet(WANTED)).toContain('\t\tbedrock = ".bedrock/",');
	});

	it("should quote an alias that is a Luau keyword", ({ expect }) => {
		expect.assertions(1);

		expect(configLuauAliasSnippet({ alias: "end", target: "x/" })).toContain('["end"] = "x/"');
	});
});
