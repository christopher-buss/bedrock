import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { assert, describe, it, vi } from "vitest";

import { createLuteConfigLuauEditor } from "./lute-config-luau-editor.ts";

const WANTED = { alias: "bedrock", target: ".bedrock/" };

const edit = createLuteConfigLuauEditor();

function lines(...text: Array<string>): string {
	return [...text, ""].join("\n");
}

describe(createLuteConfigLuauEditor, () => {
	it.skipIf(!HAS_LUTE)(
		"should add the alias to a multi-line aliases table, keeping comments and other keys",
		async ({ expect }) => {
			expect.assertions(1);

			const source = lines(
				"-- project config",
				"return {",
				"\tlute = { x = 1 }, -- keep",
				"\tluau = {",
				"\t\taliases = {",
				'\t\t\tpkg = "./Packages/", -- vendored',
				"\t\t},",
				"\t},",
				"}",
			);

			await expect(edit(source, WANTED)).resolves.toStrictEqual({
				data: {
					aliases: { pkg: "./Packages/" },
					edited: lines(
						"-- project config",
						"return {",
						"\tlute = { x = 1 }, -- keep",
						"\tluau = {",
						"\t\taliases = {",
						'\t\t\tpkg = "./Packages/", -- vendored',
						'\t\t\tbedrock = ".bedrock/",',
						"\t\t},",
						"\t},",
						"}",
					),
				},
				success: true,
			});
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should create the luau and aliases tables when the file has neither",
		async ({ expect }) => {
			expect.assertions(1);

			await expect(
				edit(lines("return {", "\tlute = {}", "}"), WANTED),
			).resolves.toStrictEqual({
				data: {
					aliases: {},
					edited: lines(
						"return {",
						"\tlute = {},",
						'\tluau = { aliases = { bedrock = ".bedrock/" } }',
						"}",
					),
				},
				success: true,
			});
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should create the aliases table inside a single-line luau table",
		async ({ expect }) => {
			expect.assertions(1);

			const result = await edit('return { luau = { lint = "*" } }', WANTED);

			expect(result).toStrictEqual({
				data: {
					aliases: {},
					edited: 'return { luau = { lint = "*", aliases = { bedrock = ".bedrock/" } } }',
				},
				success: true,
			});
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should fill an empty table and quote an alias that is not an identifier",
		async ({ expect }) => {
			expect.assertions(1);

			const result = await edit("return { luau = { aliases = {} } }", {
				alias: "my-types",
				target: ".bedrock/",
			});

			expect(result).toStrictEqual({
				data: {
					aliases: {},
					edited: 'return { luau = { aliases = { ["my-types"] = ".bedrock/" } } }',
				},
				success: true,
			});
		},
	);

	it.skipIf(!HAS_LUTE).for([
		{
			name: "the last alias",
			edited: lines(
				"return { luau = {",
				"\taliases = {",
				'\t\tpkg = "./Packages/", -- vendored',
				'\t\tbedrock = ".bedrock/"',
				"\t},",
				"} }",
			),
			source: lines(
				"return { luau = {",
				"\taliases = {",
				'\t\tpkg = "./Packages/" -- vendored',
				"\t},",
				"} }",
			),
		},
		{
			name: "the last root entry",
			edited: lines(
				"return {",
				"\tlute = {}, -- tooling",
				'\tluau = { aliases = { bedrock = ".bedrock/" } }',
				"}",
			),
			source: lines("return {", "\tlute = {} -- tooling", "}"),
		},
	])(
		"should keep a line comment on $name when it has no trailing separator",
		async ({ edited, source }, { expect }) => {
			expect.assertions(1);

			const result = await edit(source, WANTED);

			assert(result.success);

			expect(result.data.edited).toBe(edited);
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should fill an empty multi-line table on its own line",
		async ({ expect }) => {
			expect.assertions(1);

			const result = await edit(lines("return {", "}"), WANTED);

			assert(result.success);

			expect(result.data.edited).toBe(
				lines("return {", '\tluau = { aliases = { bedrock = ".bedrock/" } },', "}"),
			);
		},
	);

	it.skipIf(!HAS_LUTE).for([
		{
			edited: [
				"return {",
				"\tlute = {}, -- a",
				'\tluau = { aliases = { bedrock = ".bedrock/" } },',
				"}",
				"",
			],
			source: ["return {", "\tlute = {}, -- a", "}", ""],
		},
		{
			edited: [
				"return {",
				"\tx = 1, -- b",
				'\tluau = { aliases = { bedrock = ".bedrock/" } }',
				"}",
				"",
			],
			source: ["return {", "\tx = 1 -- b", "}", ""],
		},
	])(
		"should insert lines with the file's CRLF line ending",
		async ({ edited, source }, { expect }) => {
			expect.assertions(1);

			const result = await edit(source.join("\r\n"), WANTED);

			assert(result.success);

			expect(result.data.edited).toBe(edited.join("\r\n"));
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should add after a trailing separator on a single line",
		async ({ expect }) => {
			expect.assertions(1);

			const result = await edit('return { luau = { aliases = { pkg = "p", } } }', WANTED);

			assert(result.success);

			expect(result.data.edited).toBe(
				'return { luau = { aliases = { pkg = "p", bedrock = ".bedrock/", } } }',
			);
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should point an alias that holds a string at the target, leaving the other entries",
		async ({ expect }) => {
			expect.assertions(1);

			const result = await edit(
				'return { luau = { aliases = { bedrock = "old/", list = 1 } } }',
				WANTED,
			);

			expect(result).toStrictEqual({
				data: {
					aliases: { bedrock: "old/", list: false },
					edited: 'return { luau = { aliases = { bedrock = ".bedrock/", list = 1 } } }',
				},
				success: true,
			});
		},
	);

	it.skipIf(!HAS_LUTE)(
		"should leave the source as read when the alias is not a string literal",
		async ({ expect }) => {
			expect.assertions(1);

			const source =
				'local path = "x/"\nreturn { luau = { aliases = { ["bedrock"] = path } } }';

			await expect(edit(source, WANTED)).resolves.toStrictEqual({
				data: { aliases: { bedrock: false }, edited: source },
				success: true,
			});
		},
	);

	it.skipIf(!HAS_LUTE).for([
		{ reason: "it does not return a table literal", source: "local t = {}\nreturn t" },
		{ reason: "its luau entry is not a table literal", source: "return { luau = make() }" },
		{
			reason: "its luau.aliases entry is not a table literal",
			source: "return { luau = { aliases = shared } }",
		},
	])("should refuse a file where $reason", async ({ reason, source }, { expect }) => {
		expect.assertions(1);

		await expect(edit(source, WANTED)).resolves.toStrictEqual({
			err: { kind: "uneditableConfigLuau", reason },
			success: false,
		});
	});

	it.skipIf(!HAS_LUTE)("should refuse a file that does not parse", async ({ expect }) => {
		expect.assertions(1);

		const result = await edit("return {{{", WANTED);

		assert(!result.success);
		assert(result.err.kind === "uneditableConfigLuau");

		expect(result.err.reason).toMatch(/^it does not parse: \(0, 10\)/);
	});

	it("should remove its scratch directory once lute has run", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_LUTE_PATH", process.execPath);
		const prefix = `bedrock-config-luau-editor-${process.pid}-`;

		await edit("return {}", WANTED);

		expect(readdirSync(tmpdir()).filter((entry) => entry.startsWith(prefix))).toBeEmpty();
	});

	it("should report a missing runtime with the install hint", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_LUTE_PATH", "/nonexistent/path/to/lute-binary-xyz");

		const result = await edit("return {}", WANTED);

		assert(!result.success);
		assert(result.err.kind === "missingRuntime");

		expect(result.err.hint).toContain("BEDROCK_LUTE_PATH");
	});

	it("should stage the editor in a per-process scratch directory", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_LUTE_PATH", process.execPath);

		const result = await edit("return {}", WANTED);

		assert(!result.success);
		assert(result.err.kind === "editorFailed");

		expect(result.err.message).toContain(
			join(tmpdir(), `bedrock-config-luau-editor-${process.pid}-`),
		);
	});

	it("should report a runtime that exits with an error", async ({ expect, onTestFinished }) => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_LUTE_PATH", process.execPath);

		const result = await edit("return {}", WANTED);

		assert(!result.success);
		assert(result.err.kind === "editorFailed");

		expect(result.err.message).toContain("Command failed");
	});
});
