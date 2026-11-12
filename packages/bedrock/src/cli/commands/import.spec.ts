import type { Result } from "@bedrock-rbx/ocale";
import { fromAny } from "@total-typescript/shoehorn";

import process from "node:process";
import { describe, it, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import type { ConfigError } from "../../core/config-error.ts";
import { EMPTY_PLUGIN_REGISTRY } from "../../core/plugin-registry.ts";
import type { Config } from "../../core/schema.ts";
import type { ImportItemsError, ImportItemsOutcome } from "../../shell/import-items.ts";
import { asRobloxAssetId } from "../../types/ids.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { importCommand } from "./import.ts";

type ExitFunc = NonNullable<ProgDependencies["exit"]>;
type ImportItemsFunc = NonNullable<ProgDependencies["importItems"]>;
type LoadProjectFunc = NonNullable<ProgDependencies["loadProject"]>;

const CONFIG: Config = {
	environments: { production: {} },
	state: { backend: "gist", gistId: "abc" },
	universe: { universeId: "1" },
};

const PASS_ID = asRobloxAssetId("11");

const SELECT = { environment: "production", select: "game-pass:11", yes: true };

const EMPTY_OUTCOME: ImportItemsOutcome = {
	configWritten: false,
	edits: [],
	iconFallbacks: [],
	refused: [],
	unreadStates: [],
};

const LOADED_FROM: Result<string | undefined, ConfigError> = {
	data: "/p/bedrock.config.yaml",
	success: true,
};

function fakeLoad(result = LOADED_FROM): LoadProjectFunc {
	return vi.fn<LoadProjectFunc>(async () => {
		return result.success
			? {
					data: {
						config: CONFIG,
						plugins: EMPTY_PLUGIN_REGISTRY,
						...(result.data === undefined ? {} : { sourceFile: result.data }),
					},
					success: true,
				}
			: result;
	});
}

function fakeImport(
	result: Result<Partial<ImportItemsOutcome>, ImportItemsError>,
): ImportItemsFunc {
	return vi.fn<ImportItemsFunc>(async () => {
		return result.success
			? { data: { ...EMPTY_OUTCOME, ...result.data }, success: true }
			: result;
	});
}

function makeDependencies(overrides: Partial<ProgDependencies> = {}): ProgDependencies {
	return {
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		importItems: fakeImport({ data: { configWritten: true }, success: true }),
		loadProject: fakeLoad(),
		readTextFile: async () => "",
		...overrides,
	};
}

describe(importCommand, () => {
	it("should import the selected items into the loaded config file and exit 0", async ({
		expect,
	}) => {
		expect.assertions(5);

		const dependencies = makeDependencies();

		await importCommand(dependencies)({
			...SELECT,
			"api-key": "from-flag",
			"config": "bedrock.config.yaml",
		});

		const [options] = vi.mocked(dependencies.importItems!).mock.calls[0]!;

		expect(dependencies.loadProject).toHaveBeenCalledExactlyOnceWith({
			configFile: "bedrock.config.yaml",
		});
		expect(options).toMatchObject({
			config: CONFIG,
			configFile: "/p/bedrock.config.yaml",
			environment: "production",
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		expect(options.getEnv("BEDROCK_API_KEY")).toBe("from-flag");
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"Wrote the imported entries to /p/bedrock.config.yaml.",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should report unread States, icons to supply, text to paste and refusals, then exit 1", async ({
		expect,
	}) => {
		expect.assertions(4);

		const edit = { key: "vip", collection: "passes", entry: {}, kind: "addEntry" } as const;
		const dependencies = makeDependencies({
			importItems: fakeImport({
				data: {
					edits: [
						{ edit, status: "written" },
						{
							edit,
							paste: { path: [], text: "passes: {}" },
							reason: "notLiteral",
							status: "notSafe",
						},
						{
							edit,
							paste: { path: ["environments", "production"], text: "x: 1" },
							reason: "notLiteral",
							status: "notSafe",
						},
					],
					iconFallbacks: [
						{
							key: "vip",
							cause: fromAny(new Error("download failed")),
							kind: "gamePass",
							path: "assets/passes/vip.png",
							robloxId: PASS_ID,
						},
					],
					refused: [
						{
							kind: "badge",
							message: "badge 9 is refused.",
							reason: "notLive",
							robloxId: PASS_ID,
						},
					],
					unreadStates: ["staging"],
				},
				success: true,
			}),
			loadProject: fakeLoad({ data: undefined, success: true }),
		});

		await importCommand(dependencies)({ ...SELECT, verbose: true });

		expect(dependencies.clack!.logSuccess).not.toHaveBeenCalled();
		expect(vi.mocked(dependencies.clack!.logMessage).mock.calls.flat()).toStrictEqual([
			'The State of "staging" could not be read, so an item it tracks is not detected.',
			"'vip': the stored icon could not be downloaded. Put the icon file at assets/passes/vip.png; the entry declares iconBaseline: \"accept-local-file\".",
			expect.stringContaining("Error: download failed"),
			"Paste this into the top level in the config file:\npasses: {}",
			'Paste this into "environments.production" in the config file:\nx: 1',
		]);
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith("badge 9 is refused.");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it.for([
		[{ environment: "production", select: "game-pass:11" }, "it has no prompts yet"],
		[{ environment: "production", yes: true }, "missing required flag --select"],
		[{ ...SELECT, select: "place:1" }, '--select "place:1" is not <kind>:<id>'],
		[{ ...SELECT, env: "production" }, "unknown flag '--env'"],
	] as const)(
		"should refuse the flags %o before loading the project",
		async ([raw, line], { expect }) => {
			expect.assertions(4);

			const dependencies = makeDependencies();

			await importCommand(dependencies)(raw);

			expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
				expect.stringContaining(line),
			);
			expect(dependencies.loadProject).not.toHaveBeenCalled();
			expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("import failed");
			expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
		},
	);

	it("should open with the command name and close with its success", async ({ expect }) => {
		expect.assertions(3);

		const dependencies = makeDependencies();

		await importCommand(dependencies)(SELECT);

		expect(dependencies.clack!.intro).toHaveBeenCalledExactlyOnceWith("bedrock import");
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith("import succeeded");
		expect(dependencies.clack!.cancel).not.toHaveBeenCalled();
	});

	it("should exit 1 when the config will not load or the import cannot start", async ({
		expect,
	}) => {
		expect.assertions(4);

		const unreadable = makeDependencies({
			loadProject: fakeLoad({
				err: { kind: "fileNotFound", searchedFrom: "/p" },
				success: false,
			}),
		});
		const failing = makeDependencies({
			importItems: fakeImport({
				err: { declared: ["production"], environment: "nope", kind: "unknownEnvironment" },
				success: false,
			}),
		});

		await importCommand(unreadable)(SELECT);
		await importCommand(failing)(SELECT);

		expect(unreadable.importItems).not.toHaveBeenCalled();
		expect(unreadable.exit).toHaveBeenCalledExactlyOnceWith(1);
		expect(failing.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("nope"),
		);
		expect(failing.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should default to process.exit when no exit slot is provided", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(fromAny(() => {}));
		onTestFinished(() => {
			exitSpy.mockRestore();
		});

		await importCommand({ clack: fakeClackPort() })({});

		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
	});
});
