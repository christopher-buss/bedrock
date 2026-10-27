import { fromAny } from "@total-typescript/shoehorn";

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, it, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { captureStreams } from "#tests/helpers/streams";
import { LUAU_CONFIG_SOURCE } from "../../luau/config-source.ts";
import type { ConfigLuauEditor } from "../../ports/config-luau-editor.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { setupCommand } from "./setup.ts";

type ExitFunc = NonNullable<ProgDependencies["exit"]>;
type WriteFunc = NonNullable<ProgDependencies["writeFile"]>;

const LUAURC = join("/project", ".luaurc");
const CONFIG_LUAU = join("/project", ".config.luau");
const TYPES = join("/project", ".bedrock/config.luau");

function makeDependencies(files: Map<string, string>): ProgDependencies {
	return {
		clack: fakeClackPort(),
		configLuauEditor: async (source, { alias, target }) => {
			return {
				data: { aliases: {}, edited: `${source}-- @${alias} = ${target}\n` },
				success: true,
			};
		},
		exit: vi.fn<ExitFunc>(),
		luauConfigSource: "return {}\n",
		mkdir: async () => {},
		projectRoot: "/project",
		readOptionalTextFile: async (path) => files.get(path),
		writeFile: async (path, contents) => {
			files.set(path, contents);
		},
	};
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

describe(setupCommand, () => {
	it("should report what it wrote and exit cleanly", async ({ expect }) => {
		expect.assertions(4);

		const files = new Map<string, string>();
		const dependencies = makeDependencies(files);

		await setupCommand(dependencies)();

		expect(files.get(TYPES)).toBe("return {}\n");
		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(`wrote ${TYPES}`);
		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			`added the "@bedrock" alias to ${LUAURC}`,
		);
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_OK);
	});

	it("should report a project that is already set up as up to date", async ({ expect }) => {
		expect.assertions(2);

		const files = new Map<string, string>();
		await setupCommand(makeDependencies(files))();
		const dependencies = makeDependencies(files);

		await setupCommand(dependencies)();

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(`${TYPES} is up to date`);
		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(`${LUAURC} is up to date`);
	});

	it("should exit with an error naming the conflicting alias target", async ({ expect }) => {
		expect.assertions(3);

		const files = new Map([[LUAURC, '{"aliases":{"bedrock":"vendor/bedrock"}}']]);
		const dependencies = makeDependencies(files);

		await setupCommand(dependencies)();

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			'.luaurc already points the "@bedrock" alias at "vendor/bedrock"; rerun bedrock setup with --alias <name> to use another alias, or remove "@bedrock" from .luaurc',
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledWith(
			"setup failed; nothing was changed",
		);
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
	});

	it("should install under the alias and types path given as flags", async ({ expect }) => {
		expect.assertions(3);

		const files = new Map([[LUAURC, '{"aliases":{"bedrock":"vendor/bedrock"}}']]);
		const dependencies = makeDependencies(files);

		await setupCommand(dependencies)({
			"_": [],
			"alias": "rock",
			"types-path": "lib/config.luau",
		});

		expect(files.get(join("/project", "lib/config.luau"))).toBe("return {}\n");
		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			`added the "@rock" alias to ${LUAURC}`,
		);
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_OK);
	});

	it.for([
		{ flag: "alias", value: true },
		{ flag: "types-path", value: "" },
	])("should reject --$flag without a value", async ({ flag, value }, { expect }) => {
		expect.assertions(4);

		const files = new Map<string, string>();
		const dependencies = makeDependencies(files);

		await setupCommand(dependencies)({ [flag]: value });

		expect(dependencies.clack!.cancel).toHaveBeenCalledWith(
			"setup failed; nothing was changed",
		);
		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			`invalid value for flag '--${flag}' (expected a string)`,
		);
		expect(files).toBeEmpty();
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
	});

	it.for([
		{
			message: 'types path "/vendor/config.luau" must be relative to the project root',
			typesPath: "/vendor/config.luau",
		},
		{
			message: 'types path "../config.luau" must stay inside the project root',
			typesPath: "../config.luau",
		},
		{
			message: 'types path "vendor/types.luau" must name a file called config.luau',
			typesPath: "vendor/types.luau",
		},
	])(
		"should exit with an error and write nothing for --types-path $typesPath",
		async ({ message, typesPath }, { expect }) => {
			expect.assertions(4);

			const files = new Map<string, string>();
			const dependencies = makeDependencies(files);

			await setupCommand(dependencies)({ "types-path": typesPath });

			expect(dependencies.clack!.logError).toHaveBeenCalledWith(message);
			expect(dependencies.clack!.cancel).toHaveBeenCalledWith(
				"setup failed; nothing was changed",
			);
			expect(files).toBeEmpty();
			expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
		},
	);

	it("should exit with an error saying why a malformed luaurc cannot be updated", async ({
		expect,
	}) => {
		expect.assertions(2);

		const dependencies = makeDependencies(new Map([[LUAURC, "{"]]));

		await setupCommand(dependencies)();

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			".luaurc cannot be updated because it is not valid JSON",
		);
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
	});

	it("should exit with an error naming a file it could not read", async ({ expect }) => {
		expect.assertions(3);

		const dependencies = {
			...makeDependencies(new Map()),
			readOptionalTextFile: async () => {
				throw new Error("EACCES: permission denied");
			},
		};

		await setupCommand(dependencies)();

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			`cannot read ${join("/project", ".bedrock/setup-state.json")}: EACCES: permission denied`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledWith(
			"setup failed; nothing was changed",
		);
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
	});

	it("should exit with an error saying why the recorded setup state cannot be read", async ({
		expect,
	}) => {
		expect.assertions(2);

		const dependencies = makeDependencies(
			new Map([[join("/project", ".bedrock/setup-state.json"), "{"]]),
		);

		await setupCommand(dependencies)();

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			".bedrock/setup-state.json cannot be read because it is not valid JSON; delete it, then rerun bedrock setup",
		);
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
	});

	it("should exit with an error naming a file it could not write", async ({ expect }) => {
		expect.assertions(3);

		const dependencies = {
			...makeDependencies(new Map()),
			writeFile: async () => {
				throw new Error("ENOSPC: no space left on device");
			},
		};

		await setupCommand(dependencies)();

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			`cannot write ${TYPES}: ENOSPC: no space left on device`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledWith("setup failed");
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
	});

	it("should write the shipped types into the working directory when no slots are given", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(3);

		const projectRoot = mkdtempSync(join(tmpdir(), "bedrock-setup-"));
		const { stdout } = captureStreams({ console: true });
		vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(fromAny(() => {}));
		onTestFinished(() => {
			vi.restoreAllMocks();
			rmSync(projectRoot, { force: true, recursive: true });
		});

		await setupCommand({})();

		expect(readFileSync(join(projectRoot, ".bedrock", "config.luau"), "utf8")).toBe(
			LUAU_CONFIG_SOURCE,
		);
		expect(stdout.join("")).toContain("setup succeeded");
		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(EXIT_OK);
	});

	it("should pass the check without writing when the types match the shipped ones", async ({
		expect,
	}) => {
		expect.assertions(4);

		const files = new Map([[TYPES, "return {}\n"]]);
		const dependencies = { ...makeDependencies(files), writeFile: vi.fn<WriteFunc>() };

		await setupCommand(dependencies)({ check: true });

		expect(dependencies.writeFile).not.toHaveBeenCalled();
		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(`${TYPES} is up to date`);
		expect(dependencies.clack!.outro).toHaveBeenCalledWith("setup check passed");
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_OK);
	});

	it.for([
		[
			"stale",
			[[TYPES, "return { old = true }\n"]],
			`${TYPES} is out of date for this bedrock version; run bedrock setup to refresh it`,
		],
		["missing", [], `${TYPES} is missing; run bedrock setup to write it`],
	] as const)(
		"should fail the check without writing when the types are %s",
		async ([, initial, message], { expect }) => {
			expect.assertions(4);

			const files = new Map<string, string>(initial);
			const dependencies = { ...makeDependencies(files), writeFile: vi.fn<WriteFunc>() };

			await setupCommand(dependencies)({ check: true });

			expect(dependencies.writeFile).not.toHaveBeenCalled();
			expect(dependencies.clack!.logError).toHaveBeenCalledWith(message);
			expect(dependencies.clack!.cancel).toHaveBeenCalledWith("setup check failed");
			expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
		},
	);

	it("should fail the check naming a types file it could not read", async ({ expect }) => {
		expect.assertions(3);

		const dependencies = {
			...makeDependencies(new Map()),
			readOptionalTextFile: rejectingAt(TYPES, new Error("EACCES: permission denied")),
		};

		await setupCommand(dependencies)({ check: true });

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			`cannot read ${TYPES}: EACCES: permission denied`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledWith("setup check failed");
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
	});

	it("should check the types at the path a prior run recorded", async ({ expect }) => {
		expect.assertions(2);

		const files = new Map<string, string>();
		await setupCommand(makeDependencies(files))({ "types-path": "vendor/config.luau" });
		const dependencies = makeDependencies(files);

		await setupCommand(dependencies)({ check: true });

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			`${join("/project", "vendor/config.luau")} is up to date`,
		);
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_OK);
	});

	it("should add the alias to a .config.luau and name it in the report", async ({ expect }) => {
		expect.assertions(3);

		const files = new Map([[CONFIG_LUAU, "return {}\n"]]);
		const dependencies = makeDependencies(files);

		await setupCommand(dependencies)();

		expect(files.get(CONFIG_LUAU)).toBe("return {}\n-- @bedrock = .bedrock/\n");
		expect(files.has(LUAURC)).toBeFalse();
		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			`added the "@bedrock" alias to ${CONFIG_LUAU}`,
		);
	});

	it.for<[string, Awaited<ReturnType<ConfigLuauEditor>>, string]>([
		[
			"a conflicting alias",
			{ data: { aliases: { bedrock: "lib/" }, edited: "" }, success: true },
			'.config.luau already points the "@bedrock" alias at "lib/"; rerun bedrock setup with --alias <name> to use another alias, or remove "@bedrock" from .config.luau',
		],
		[
			"a file it cannot edit",
			{
				err: { kind: "uneditableConfigLuau", reason: "it does not return a table literal" },
				success: false,
			},
			`${CONFIG_LUAU} cannot be updated because it does not return a table literal; add the alias under luau.aliases in the table it returns, then rerun bedrock setup:\nluau = {\n\taliases = {\n\t\tbedrock = ".bedrock/",\n\t},\n},`,
		],
		[
			"a missing lute",
			{ err: { hint: "install lute", kind: "missingRuntime" }, success: false },
			"cannot edit .config.luau without the lute runtime; install lute",
		],
		[
			"a failed lute run",
			{ err: { kind: "editorFailed", message: "exit 1" }, success: false },
			"cannot edit .config.luau: exit 1",
		],
	])(
		"should exit with an error and write nothing for %s in .config.luau",
		async ([, outcome, message], { expect }) => {
			expect.assertions(3);

			const files = new Map([[CONFIG_LUAU, "return {}\n"]]);
			const dependencies = {
				...makeDependencies(files),
				configLuauEditor: async () => outcome,
				writeFile: vi.fn<WriteFunc>(),
			};

			await setupCommand(dependencies)();

			expect(dependencies.clack!.logError).toHaveBeenCalledWith(message);
			expect(dependencies.writeFile).not.toHaveBeenCalled();
			expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
		},
	);

	it("should exit with an error naming both config files when the project has both", async ({
		expect,
	}) => {
		expect.assertions(3);

		const files = new Map([
			[CONFIG_LUAU, "return {}\n"],
			[LUAURC, "{}"],
		]);
		const dependencies = { ...makeDependencies(files), writeFile: vi.fn<WriteFunc>() };

		await setupCommand(dependencies)();

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			`${LUAURC} and ${CONFIG_LUAU} both exist, and Luau accepts only one config file per directory; remove one, then rerun bedrock setup`,
		);
		expect(dependencies.writeFile).not.toHaveBeenCalled();
		expect(dependencies.exit).toHaveBeenCalledWith(EXIT_ERROR);
	});
});
