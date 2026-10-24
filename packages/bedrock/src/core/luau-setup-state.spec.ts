import { describe, it } from "vitest";

import {
	luauAliasTarget,
	parseLuauSetupState,
	resolveLuauSetup,
	serializeLuauSetupState,
} from "./luau-setup-state.ts";

describe(resolveLuauSetup, () => {
	it("should use the defaults when nothing was recorded or passed", ({ expect }) => {
		expect.assertions(1);

		expect(resolveLuauSetup(undefined, {})).toStrictEqual({
			alias: "bedrock",
			typesPath: ".bedrock/config.luau",
		});
	});

	it("should honour what a prior run recorded", ({ expect }) => {
		expect.assertions(1);

		const recorded = { alias: "rock", typesPath: "vendor/config.luau" };

		expect(resolveLuauSetup(recorded, {})).toStrictEqual(recorded);
	});

	it("should let flags win over what a prior run recorded", ({ expect }) => {
		expect.assertions(1);

		const recorded = { alias: "rock", typesPath: "vendor/config.luau" };

		expect(
			resolveLuauSetup(recorded, { alias: "br", typesPath: "lib/config.luau" }),
		).toStrictEqual({ alias: "br", typesPath: "lib/config.luau" });
	});
});

describe(luauAliasTarget, () => {
	it.for([
		{ target: ".bedrock/", typesPath: ".bedrock/config.luau" },
		{ target: "vendor/bedrock/", typesPath: "vendor/bedrock/config.luau" },
		{ target: "./", typesPath: "config.luau" },
	])("should point $typesPath's alias at its directory", ({ target, typesPath }, { expect }) => {
		expect.assertions(1);

		expect(luauAliasTarget(typesPath)).toBe(target);
	});
});

describe(parseLuauSetupState, () => {
	it("should report no state when the file is absent", ({ expect }) => {
		expect.assertions(1);

		expect(parseLuauSetupState(undefined)).toStrictEqual({ data: undefined, success: true });
	});

	it("should read back what it serialized", ({ expect }) => {
		expect.assertions(1);

		const state = { alias: "rock", typesPath: "vendor/config.luau" };

		expect(parseLuauSetupState(serializeLuauSetupState(state))).toStrictEqual({
			data: state,
			success: true,
		});
	});

	it.for([
		["{", "it is not valid JSON"],
		["[]", "its root is not a JSON object"],
		['{"alias":"rock"}', 'its "alias" and "typesPath" entries are not both strings'],
		['{"typesPath":"x.luau"}', 'its "alias" and "typesPath" entries are not both strings'],
	])("should reject %s", ([content, message], { expect }) => {
		expect.assertions(1);

		expect(parseLuauSetupState(content)).toStrictEqual({
			err: { kind: "malformedSetupState", message },
			success: false,
		});
	});
});

describe(serializeLuauSetupState, () => {
	it("should write the state as tab-indented JSON", ({ expect }) => {
		expect.assertions(1);

		expect(
			serializeLuauSetupState({ alias: "bedrock", typesPath: ".bedrock/config.luau" }),
		).toBe('{\n\t"alias": "bedrock",\n\t"typesPath": ".bedrock/config.luau"\n}\n');
	});
});
