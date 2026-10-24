import { describe, it } from "vitest";

import { setupLuauTypesAsync, type SetupLuauTypesDeps } from "./setup-luau-types.ts";

const ROOT = "/project";
const SOURCE = "return {}\n";
const LUAURC = "/project/.luaurc";
const TYPES = "/project/.bedrock/config.luau";
const STATE = "/project/.bedrock/setup-state.json";
const MERGED_LUAURC = '{\n\t"aliases": {\n\t\t"bedrock": ".bedrock/"\n\t}\n}\n';
const DEFAULT_STATE = '{\n\t"alias": "bedrock",\n\t"typesPath": ".bedrock/config.luau"\n}\n';

interface FakeProject {
	readonly deps: SetupLuauTypesDeps;
	readonly directories: Array<string>;
	readonly files: Map<string, string>;
	readonly writes: Array<string>;
}

function fakeProject(
	initial: Record<string, string> = {},
	overrides: NonNullable<SetupLuauTypesDeps["overrides"]> = {},
): FakeProject {
	const files = new Map(Object.entries(initial));
	const writes: Array<string> = [];
	const directories: Array<string> = [];
	return {
		deps: {
			bundledSource: SOURCE,
			mkdir: async (path) => {
				directories.push(path);
			},
			overrides,
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

/**
 * Wrap a path-taking seam so it rejects with `cause` for one path.
 *
 * @template Args - The seam's parameters, path first.
 * @template R - The seam's resolved value.
 * @param seam - The seam to delegate to for every other path.
 * @param failure - The path whose call rejects and the rejection value.
 * @returns The wrapped seam.
 * @rejects The given cause when called with the failing path.
 */
function rejectingAt<Args extends [string, ...Array<string>], R>(
	seam: (...args: Args) => Promise<R>,
	{ cause, failingPath }: { readonly cause: Error; readonly failingPath: string },
): (...args: Args) => Promise<R> {
	return async (...args) => {
		if (args[0] === failingPath) {
			throw cause;
		}

		return seam(...args);
	};
}

describe(setupLuauTypesAsync, () => {
	it("should write the types and a new luaurc into a project that has neither", async ({
		expect,
	}) => {
		expect.assertions(2);

		const project = fakeProject();

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			data: {
				alias: "bedrock",
				luaurcPath: LUAURC,
				luaurcWritten: true,
				typesPath: TYPES,
				typesWritten: true,
			},
			success: true,
		});
		expect(Object.fromEntries(project.files)).toStrictEqual({
			[LUAURC]: MERGED_LUAURC,
			[STATE]: DEFAULT_STATE,
			[TYPES]: SOURCE,
		});
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

		const project = fakeProject({
			[LUAURC]: MERGED_LUAURC,
			[STATE]: DEFAULT_STATE,
			[TYPES]: SOURCE,
		});

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			data: {
				alias: "bedrock",
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

		const project = fakeProject({
			[LUAURC]: MERGED_LUAURC,
			[STATE]: DEFAULT_STATE,
			[TYPES]: "-- old\n",
		});

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

	it.for([STATE, LUAURC, TYPES])(
		"should report %s when reading it fails and write nothing",
		async (failingPath, { expect }) => {
			expect.assertions(2);

			const project = fakeProject();
			const cause = new Error("EACCES");
			const failing = {
				...project.deps,
				readOptionalTextFile: rejectingAt(project.deps.readOptionalTextFile, {
					cause,
					failingPath,
				}),
			};

			const result = await setupLuauTypesAsync(failing);

			expect(result).toStrictEqual({
				err: { cause, kind: "fileReadFailed", path: failingPath },
				success: false,
			});
			expect(project.writes).toBeEmpty();
		},
	);

	it("should report the directory it could not create", async ({ expect }) => {
		expect.assertions(2);

		const project = fakeProject();
		const cause = new Error("EROFS");
		const failing = {
			...project.deps,
			mkdir: async () => {
				throw cause;
			},
		};

		const result = await setupLuauTypesAsync(failing);

		expect(result).toStrictEqual({
			err: { cause, kind: "fileWriteFailed", path: "/project/.bedrock" },
			success: false,
		});
		expect(project.writes).toBeEmpty();
	});

	it("should install under the alias and types path passed on the command line", async ({
		expect,
	}) => {
		expect.assertions(2);

		const project = fakeProject(
			{ [LUAURC]: '{"aliases":{"bedrock":"elsewhere/"}}' },
			{ alias: "rock", typesPath: "./vendor\\bedrock/config.luau" },
		);

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			data: {
				alias: "rock",
				luaurcPath: LUAURC,
				luaurcWritten: true,
				typesPath: "/project/vendor/bedrock/config.luau",
				typesWritten: true,
			},
			success: true,
		});
		expect(Object.fromEntries(project.files)).toStrictEqual({
			"/project/vendor/bedrock/config.luau": SOURCE,
			[LUAURC]:
				'{\n\t"aliases": {\n\t\t"bedrock": "elsewhere/",\n\t\t"rock": "vendor/bedrock/"\n\t}\n}\n',
			[STATE]: '{\n\t"alias": "rock",\n\t"typesPath": "vendor/bedrock/config.luau"\n}\n',
		});
	});

	it("should honour the alias and types path a prior run recorded", async ({ expect }) => {
		expect.assertions(1);

		const first = fakeProject({}, { alias: "rock", typesPath: "vendor/config.luau" });
		await setupLuauTypesAsync(first.deps);
		const second = fakeProject(Object.fromEntries(first.files));

		await setupLuauTypesAsync(second.deps);

		expect(second.writes).toBeEmpty();
	});

	it("should move its own alias when the types path changes", async ({ expect }) => {
		expect.assertions(2);

		const project = fakeProject(
			{ [LUAURC]: MERGED_LUAURC, [STATE]: DEFAULT_STATE, [TYPES]: SOURCE },
			{ typesPath: "vendor/bedrock/config.luau" },
		);

		const result = await setupLuauTypesAsync(project.deps);

		expect(result.success).toBeTrue();
		expect(project.files.get(LUAURC)).toBe(
			'{\n\t"aliases": {\n\t\t"bedrock": "vendor/bedrock/"\n\t}\n}\n',
		);
	});

	it("should change nothing when the recorded alias points somewhere setup did not put it", async ({
		expect,
	}) => {
		expect.assertions(2);

		const project = fakeProject(
			{ [LUAURC]: '{"aliases":{"bedrock":"elsewhere/"}}', [STATE]: DEFAULT_STATE },
			{ typesPath: "vendor/bedrock/config.luau" },
		);

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			err: { alias: "bedrock", existingTarget: "elsewhere/", kind: "aliasConflict" },
			success: false,
		});
		expect(project.writes).toBeEmpty();
	});

	it("should leave an alias it did not record alone when the alias changes", async ({
		expect,
	}) => {
		expect.assertions(1);

		const project = fakeProject(
			{ [LUAURC]: MERGED_LUAURC, [STATE]: DEFAULT_STATE, [TYPES]: SOURCE },
			{ alias: "rock", typesPath: "vendor/bedrock/config.luau" },
		);

		await setupLuauTypesAsync(project.deps);

		expect(project.files.get(LUAURC)).toBe(
			'{\n\t"aliases": {\n\t\t"bedrock": ".bedrock/",\n\t\t"rock": "vendor/bedrock/"\n\t}\n}\n',
		);
	});

	it("should change nothing when the types path is unusable", async ({ expect }) => {
		expect.assertions(2);

		const project = fakeProject({}, { typesPath: "/vendor/config.luau" });

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			err: { kind: "absoluteTypesPath", typesPath: "/vendor/config.luau" },
			success: false,
		});
		expect(project.writes).toBeEmpty();
	});

	it("should change nothing when the recorded state is malformed", async ({ expect }) => {
		expect.assertions(2);

		const project = fakeProject({ [STATE]: "{" });

		const result = await setupLuauTypesAsync(project.deps);

		expect(result).toStrictEqual({
			err: { kind: "malformedSetupState", message: "it is not valid JSON" },
			success: false,
		});
		expect(project.writes).toBeEmpty();
	});

	it("should leave the luaurc alone when recording the setup state fails", async ({ expect }) => {
		expect.assertions(1);

		const project = fakeProject();
		const failing = {
			...project.deps,
			writeFile: rejectingAt(project.deps.writeFile, {
				cause: new Error("ENOSPC"),
				failingPath: STATE,
			}),
		};

		await setupLuauTypesAsync(failing);

		expect(project.files.has(LUAURC)).toBeFalse();
	});

	it.for([TYPES, LUAURC, STATE])(
		"should report %s when writing it fails",
		async (failingPath, { expect }) => {
			expect.assertions(1);

			const project = fakeProject();
			const cause = new Error("ENOSPC");
			const failing = {
				...project.deps,
				writeFile: rejectingAt(project.deps.writeFile, { cause, failingPath }),
			};

			const result = await setupLuauTypesAsync(failing);

			expect(result).toStrictEqual({
				err: { cause, kind: "fileWriteFailed", path: failingPath },
				success: false,
			});
		},
	);
});
