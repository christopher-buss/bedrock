import { assert, describe, it } from "vitest";

import { addLuaurcAlias } from "./luaurc.ts";

const WANTED = { alias: "bedrock", target: ".bedrock" };

describe(addLuaurcAlias, () => {
	it("should create a luaurc holding only the alias when none exists", ({ expect }) => {
		expect.assertions(1);

		expect(addLuaurcAlias(undefined, WANTED)).toStrictEqual({
			data: {
				changed: true,
				content: '{\n\t"aliases": {\n\t\t"bedrock": ".bedrock"\n\t}\n}\n',
			},
			success: true,
		});
	});

	it("should treat a blank luaurc as a new file", ({ expect }) => {
		expect.assertions(1);

		expect(addLuaurcAlias(" \n", WANTED)).toStrictEqual({
			data: {
				changed: true,
				content: '{\n\t"aliases": {\n\t\t"bedrock": ".bedrock"\n\t}\n}\n',
			},
			success: true,
		});
	});

	it("should keep existing aliases and other keys", ({ expect }) => {
		expect.assertions(1);

		const result = addLuaurcAlias(
			'{ "languageMode": "strict", "aliases": { "pkg": "Packages" } }',
			WANTED,
		);

		assert(result.success);

		expect(JSON.parse(result.data.content)).toStrictEqual({
			aliases: { bedrock: ".bedrock", pkg: "Packages" },
			languageMode: "strict",
		});
	});

	it("should add an aliases table to a luaurc that has none", ({ expect }) => {
		expect.assertions(1);

		expect(addLuaurcAlias('{"languageMode":"strict"}', WANTED)).toStrictEqual({
			data: {
				changed: true,
				content:
					'{\n\t"languageMode": "strict",\n\t"aliases": {\n\t\t"bedrock": ".bedrock"\n\t}\n}\n',
			},
			success: true,
		});
	});

	it("should leave the content untouched when the alias already points at the target", ({
		expect,
	}) => {
		expect.assertions(1);

		const content = '{"aliases":{"bedrock":".bedrock"}}';

		expect(addLuaurcAlias(content, WANTED)).toStrictEqual({
			data: { changed: false, content },
			success: true,
		});
	});

	it("should produce content a rerun leaves unchanged", ({ expect }) => {
		expect.assertions(1);

		const first = addLuaurcAlias('{"aliases":{"pkg":"Packages"}}', WANTED);
		assert(first.success);

		expect(addLuaurcAlias(first.data.content, WANTED)).toStrictEqual({
			data: { changed: false, content: first.data.content },
			success: true,
		});
	});

	it.for(["./.bedrock", ".bedrock/", "./.bedrock//"])(
		"should leave a luaurc unchanged when its alias already points at %s",
		(existing, { expect }) => {
			expect.assertions(1);

			const content = `{"aliases":{"bedrock":"${existing}"}}`;

			expect(addLuaurcAlias(content, WANTED)).toStrictEqual({
				data: { changed: false, content },
				success: true,
			});
		},
	);

	it("should report a conflict naming the target the alias already points at", ({ expect }) => {
		expect.assertions(1);

		expect(addLuaurcAlias('{"aliases":{"bedrock":"vendor/bedrock"}}', WANTED)).toStrictEqual({
			err: { alias: "bedrock", existingTarget: "vendor/bedrock", kind: "aliasConflict" },
			success: false,
		});
	});

	it.for([
		["{ aliases", "it is not valid JSON"],
		["[]", "its root is not a JSON object"],
		['{"aliases":[]}', 'its "aliases" entry is not a JSON object'],
		['{"aliases":{"bedrock":1}}', 'its "bedrock" alias does not point at a string path'],
	])("should report a malformed luaurc for %s", ([content, message], { expect }) => {
		expect.assertions(1);

		expect(addLuaurcAlias(content, WANTED)).toStrictEqual({
			err: { kind: "malformedLuaurc", message },
			success: false,
		});
	});
});
