import { join } from "node:path";
import { assert, describe, it } from "vitest";

import type { ConfigLuauEditor } from "../ports/config-luau-editor.ts";
import { checkLuauTypesStaleAsync } from "./check-luau-types-stale.ts";

const TYPES = join("/project", ".bedrock/config.luau");
const STATE = join("/project", ".bedrock/setup-state.json");
const CONFIG_LUAU = join("/project", ".config.luau");
const LUAURC = join("/project", ".luaurc");

/**
 * A `ConfigLuauEditor` that reports `aliases` without running lute.
 *
 * @param aliases - What the fake reports as already declared, by name.
 * @returns An editor that echoes the source back as its edit.
 */
function fakeEditor(aliases: Record<string, unknown> = {}): ConfigLuauEditor {
	return async (source) => ({ data: { aliases, edited: `${source}--edited\n` }, success: true });
}

function readsOnly(
	target: string,
	contents: string | undefined,
): (path: string) => Promise<string | undefined> {
	return async (path) => (path === target ? contents : undefined);
}

function readsFiles(files: Record<string, string>): (path: string) => Promise<string | undefined> {
	const onDisk = new Map(Object.entries(files));
	return async (path) => onDisk.get(path);
}

async function check(onDisk: string | undefined): ReturnType<typeof checkLuauTypesStaleAsync> {
	return checkLuauTypesStaleAsync({
		bundledSource: "return {}\n",
		configLuauEditor: fakeEditor(),
		projectRoot: "/project",
		readOptionalTextFile: readsOnly(TYPES, onDisk),
	});
}

/**
 * A read seam that rejects with `cause` for one path and finds nothing
 * elsewhere.
 *
 * @param failingPath - The path whose read rejects.
 * @param cause - The rejection value.
 * @returns The read seam.
 * @rejects The given cause when called with the failing path.
 */
function rejectingAt(
	failingPath: string,
	cause: Error,
): (path: string) => Promise<string | undefined> {
	return async (path) => {
		if (path === failingPath) {
			throw cause;
		}
	};
}

describe(checkLuauTypesStaleAsync, () => {
	it("should report types matching the shipped source as fresh", async ({ expect }) => {
		expect.assertions(1);

		await expect(check("return {}\n")).resolves.toStrictEqual({
			data: { aliasIssue: undefined, status: "fresh", typesPath: TYPES },
			success: true,
		});
	});

	it("should report types differing from the shipped source by any byte as stale", async ({
		expect,
	}) => {
		expect.assertions(1);

		await expect(check("return {}\n\n")).resolves.toStrictEqual({
			data: { aliasIssue: undefined, status: "stale", typesPath: TYPES },
			success: true,
		});
	});

	it("should report absent types as missing", async ({ expect }) => {
		expect.assertions(1);

		await expect(check(undefined)).resolves.toStrictEqual({
			data: { aliasIssue: undefined, status: "missing", typesPath: TYPES },
			success: true,
		});
	});

	it("should read the types file at the path a prior setup recorded", async ({ expect }) => {
		expect.assertions(1);

		await expect(
			checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				configLuauEditor: fakeEditor(),
				projectRoot: "/project",
				readOptionalTextFile: readsFiles({
					[join("/project", "vendor/config.luau")]: "return {}\n",
					[STATE]: '{"alias":"rock","typesPath":"vendor/config.luau"}',
				}),
			}),
		).resolves.toStrictEqual({
			data: {
				aliasIssue: undefined,
				status: "fresh",
				typesPath: join("/project", "vendor/config.luau"),
			},
			success: true,
		});
	});

	it("should report a recorded setup state it cannot read", async ({ expect }) => {
		expect.assertions(1);

		await expect(
			checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				configLuauEditor: fakeEditor(),
				projectRoot: "/project",
				readOptionalTextFile: readsFiles({ [STATE]: "{" }),
			}),
		).resolves.toStrictEqual({
			err: { kind: "malformedSetupState", message: "it is not valid JSON" },
			success: false,
		});
	});

	it("should report a recorded types path it cannot use", async ({ expect }) => {
		expect.assertions(1);

		await expect(
			checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				configLuauEditor: fakeEditor(),
				projectRoot: "/project",
				readOptionalTextFile: readsFiles({
					[STATE]: '{"alias":"bedrock","typesPath":"/abs/config.luau"}',
				}),
			}),
		).resolves.toStrictEqual({
			err: { kind: "absoluteTypesPath", typesPath: "/abs/config.luau" },
			success: false,
		});
	});

	it.for([STATE, TYPES])(
		"should report %s as a read failure when it cannot be read",
		async (failingPath, { expect }) => {
			expect.assertions(1);

			const cause = new Error("EACCES: permission denied");

			await expect(
				checkLuauTypesStaleAsync({
					bundledSource: "return {}\n",
					configLuauEditor: fakeEditor(),
					projectRoot: "/project",
					readOptionalTextFile: rejectingAt(failingPath, cause),
				}),
			).resolves.toStrictEqual({
				err: { cause, kind: "fileReadFailed", path: failingPath },
				success: false,
			});
		},
	);

	describe("the .config.luau alias", () => {
		async function checkAlias(
			files: Record<string, string>,
			configLuauEditor: ConfigLuauEditor = fakeEditor(),
		): ReturnType<typeof checkLuauTypesStaleAsync> {
			return checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				configLuauEditor,
				projectRoot: "/project",
				readOptionalTextFile: readsFiles({ [TYPES]: "return {}\n", ...files }),
			});
		}

		it("should report a .config.luau that does not declare the alias", async ({ expect }) => {
			expect.assertions(1);

			await expect(checkAlias({ [CONFIG_LUAU]: "return {}" })).resolves.toStrictEqual({
				data: {
					aliasIssue: { alias: "bedrock", configPath: CONFIG_LUAU, kind: "aliasMissing" },
					status: "fresh",
					typesPath: TYPES,
				},
				success: true,
			});
		});

		it("should report a .config.luau alias that points elsewhere", async ({ expect }) => {
			expect.assertions(1);

			const result = await checkAlias(
				{ [CONFIG_LUAU]: "return {}" },
				fakeEditor({ bedrock: "lib/" }),
			);

			assert(result.success);

			expect(result.data.aliasIssue).toStrictEqual({
				alias: "bedrock",
				configPath: CONFIG_LUAU,
				kind: "aliasPointsElsewhere",
			});
		});

		it.for<[string, Record<string, string>, ConfigLuauEditor]>([
			[
				"it already points at the types",
				{ [CONFIG_LUAU]: "" },
				fakeEditor({ bedrock: ".bedrock" }),
			],
			["the project uses a .luaurc without the alias", { [LUAURC]: "{}" }, fakeEditor()],
			[
				"the project uses a .luaurc whose alias points elsewhere",
				{ [LUAURC]: '{"aliases":{"bedrock":"lib/"}}' },
				fakeEditor(),
			],
			[
				"the .config.luau cannot be read as a literal table",
				{ [CONFIG_LUAU]: "" },
				async () => {
					return { err: { kind: "uneditableConfigLuau", reason: "x" }, success: false };
				},
			],
		])("should report no alias issue when %s", async ([, files, editor], { expect }) => {
			expect.assertions(1);

			const result = await checkAlias(files, editor);

			assert(result.success);

			expect(result.data.aliasIssue).toBeUndefined();
		});

		it("should not check the alias while the types are missing", async ({ expect }) => {
			expect.assertions(1);

			const result = await checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				configLuauEditor: fakeEditor(),
				projectRoot: "/project",
				readOptionalTextFile: readsFiles({ [CONFIG_LUAU]: "return {}" }),
			});

			expect(result).toStrictEqual({
				data: { aliasIssue: undefined, status: "missing", typesPath: TYPES },
				success: true,
			});
		});
	});
});
