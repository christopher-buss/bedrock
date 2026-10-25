import { describe, it } from "vitest";

import { parseSetupOptions } from "./parse-setup-options.ts";

describe(parseSetupOptions, () => {
	it("should read the alias and types path off the flags", ({ expect }) => {
		expect.assertions(1);

		expect(
			parseSetupOptions({ "_": [], "alias": "rock", "types-path": "lib/config.luau" }),
		).toStrictEqual({ data: { alias: "rock", typesPath: "lib/config.luau" }, success: true });
	});

	it("should leave both unset when no flag names them", ({ expect }) => {
		expect.assertions(1);

		expect(parseSetupOptions({})).toStrictEqual({
			data: { alias: undefined, typesPath: undefined },
			success: true,
		});
	});

	it("should drop one leading @ from the alias", ({ expect }) => {
		expect.assertions(1);

		expect(parseSetupOptions({ alias: "@@rock" })).toStrictEqual({
			data: { alias: "@rock", typesPath: undefined },
			success: true,
		});
	});

	it.for([
		{ flag: "alias", value: "@" },
		{ flag: "alias", value: true },
		{ flag: "alias", value: "" },
		{ flag: "types-path", value: "" },
	])("should reject --$flag holding $value", ({ flag, value }, { expect }) => {
		expect.assertions(1);

		expect(parseSetupOptions({ [flag]: value })).toStrictEqual({
			err: { flag, kind: "invalidValue" },
			success: false,
		});
	});

	it("should reject a flag setup does not take", ({ expect }) => {
		expect.assertions(1);

		expect(parseSetupOptions({ "env": "prod", "types-path": "lib/config.luau" })).toStrictEqual(
			{
				err: { flag: "env", kind: "unknownFlag" },
				success: false,
			},
		);
	});
});
