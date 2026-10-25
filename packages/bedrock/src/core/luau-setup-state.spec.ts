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
			data: { alias: "bedrock", typesPath: ".bedrock/config.luau" },
			success: true,
		});
	});

	it("should honour what a prior run recorded", ({ expect }) => {
		expect.assertions(1);

		const recorded = { alias: "rock", typesPath: "vendor/config.luau" };

		expect(resolveLuauSetup(recorded, {})).toStrictEqual({ data: recorded, success: true });
	});

	it("should let flags win over what a prior run recorded", ({ expect }) => {
		expect.assertions(1);

		const recorded = { alias: "rock", typesPath: "vendor/config.luau" };

		expect(
			resolveLuauSetup(recorded, { alias: "br", typesPath: "lib/config.luau" }),
		).toStrictEqual({ data: { alias: "br", typesPath: "lib/config.luau" }, success: true });
	});

	it("should write the types path with forward slashes and no redundant segments", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(
			resolveLuauSetup(undefined, { typesPath: ".\\vendor\\bedrock/../bedrock/config.luau" }),
		).toStrictEqual({
			data: { alias: "bedrock", typesPath: "vendor/bedrock/config.luau" },
			success: true,
		});
	});

	it.for(["/vendor/config.luau", "C:\\vendor\\config.luau", "c:/vendor/config.luau"])(
		"should refuse the absolute types path %s",
		(typesPath, { expect }) => {
			expect.assertions(1);

			expect(resolveLuauSetup(undefined, { typesPath })).toStrictEqual({
				err: { kind: "absoluteTypesPath", typesPath },
				success: false,
			});
		},
	);

	it.for(["../config.luau", "vendor/../../config.luau", "..\\shared\\config.luau"])(
		"should refuse the types path %s, which leaves the project root",
		(typesPath, { expect }) => {
			expect.assertions(1);

			expect(resolveLuauSetup(undefined, { typesPath })).toStrictEqual({
				err: { kind: "typesPathOutsideProject", typesPath },
				success: false,
			});
		},
	);

	it.for(["vendor/types.luau", "vendor/config.luau/", "config.lua", "vendor/my-config.luau"])(
		"should refuse the types path %s, which is not a config.luau file",
		(typesPath, { expect }) => {
			expect.assertions(1);

			expect(resolveLuauSetup(undefined, { typesPath })).toStrictEqual({
				err: { kind: "typesFileNotConfig", typesPath },
				success: false,
			});
		},
	);
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
		['{"alias":"","typesPath":"config.luau"}', 'its "alias" entry is empty'],
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
