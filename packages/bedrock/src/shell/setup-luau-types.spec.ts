import { describe, it } from "vitest";

import { setupLuauTypesAsync, type SetupLuauTypesDeps } from "./setup-luau-types.ts";

const ROOT = "/project";
const SOURCE = "return {}\n";
const LUAURC = "/project/.luaurc";
const TYPES = "/project/.bedrock/config.luau";
const MERGED_LUAURC = '{\n\t"aliases": {\n\t\t"bedrock": ".bedrock/"\n\t}\n}\n';

interface FakeProject {
	readonly deps: SetupLuauTypesDeps;
	readonly directories: Array<string>;
	readonly files: Map<string, string>;
	readonly writes: Array<string>;
}

function fakeProject(initial: Record<string, string> = {}): FakeProject {
	const files = new Map(Object.entries(initial));
	const writes: Array<string> = [];
	const directories: Array<string> = [];
	return {
		deps: {
			bundledSource: SOURCE,
			mkdir: async (path) => {
				directories.push(path);
			},
			projectRoot: ROOT,
			readOptionalTextFile: async (path) => files.get(path),
			writeFile: async (path, contents) => {
				writes.push(path);
				files.set(path, contents);
			},
		},
		directories,
		files,
		writes,
	};
}

describe(setupLuauTypesAsync, () => {
	it("should write the types and a new luaurc into a project that has neither", async ({
		expect,
	}) => {
		expect.assertions(3);

		const project = fakeProject();

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			data: {
				luaurcPath: LUAURC,
				luaurcWritten: true,
				typesPath: TYPES,
				typesWritten: true,
			},
			success: true,
		});
		expect(Object.fromEntries(project.files)).toStrictEqual({
			[LUAURC]: MERGED_LUAURC,
			[TYPES]: SOURCE,
		});
		expect(project.directories).toStrictEqual(["/project/.bedrock"]);
	});

	it("should keep the aliases an existing luaurc declares", async ({ expect }) => {
		expect.assertions(1);

		const project = fakeProject({ [LUAURC]: '{"aliases":{"pkg":"Packages"}}' });

		await setupLuauTypesAsync(project.deps);

		expect(project.files.get(LUAURC)).toBe(
			'{\n\t"aliases": {\n\t\t"pkg": "Packages",\n\t\t"bedrock": ".bedrock/"\n\t}\n}\n',
		);
	});

	it("should write nothing when the project is already set up", async ({ expect }) => {
		expect.assertions(2);

		const project = fakeProject({ [LUAURC]: MERGED_LUAURC, [TYPES]: SOURCE });

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			data: {
				luaurcPath: LUAURC,
				luaurcWritten: false,
				typesPath: TYPES,
				typesWritten: false,
			},
			success: true,
		});
		expect(project.writes).toBeEmpty();
	});

	it("should rewrite types that differ from the bundled source", async ({ expect }) => {
		expect.assertions(2);

		const project = fakeProject({ [LUAURC]: MERGED_LUAURC, [TYPES]: "-- old\n" });

		await setupLuauTypesAsync(project.deps);

		expect(project.writes).toStrictEqual([TYPES]);
		expect(project.files.get(TYPES)).toBe(SOURCE);
	});

	it("should change nothing when the bedrock alias points elsewhere", async ({ expect }) => {
		expect.assertions(3);

		const project = fakeProject({ [LUAURC]: '{"aliases":{"bedrock":"vendor/bedrock"}}' });

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			err: { alias: "bedrock", existingTarget: "vendor/bedrock", kind: "aliasConflict" },
			success: false,
		});
		expect(project.writes).toBeEmpty();
		expect(project.directories).toBeEmpty();
	});

	it("should change nothing when the luaurc is malformed", async ({ expect }) => {
		expect.assertions(2);

		const project = fakeProject({ [LUAURC]: "{" });

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			err: { kind: "malformedLuaurc", message: "it is not valid JSON" },
			success: false,
		});
		expect(project.writes).toBeEmpty();
	});
});
