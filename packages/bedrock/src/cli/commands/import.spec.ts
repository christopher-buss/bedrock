import type { Result } from "@bedrock-rbx/ocale";
import { fromAny } from "@total-typescript/shoehorn";

import process from "node:process";
import { describe, it, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { fakeImportPromptPort } from "#tests/helpers/import-prompt-port";
import type { ConfigError } from "../../core/config-error.ts";
import type { ImportLink } from "../../core/import-links.ts";
import type { ImportItem } from "../../core/import-plan-types.ts";
import { EMPTY_PLUGIN_REGISTRY } from "../../core/plugin-registry.ts";
import type { Config } from "../../core/schema.ts";
import type {
	ImportCancelled,
	ImportChoice,
	ImportItemsError,
	ImportItemsOutcome,
} from "../../shell/import-items.ts";
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
	links: [],
	redacted: [],
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

function item(
	kind: ImportItem["kind"],
	{
		id,
		key,
		trackedBy,
	}: { readonly id: string; readonly key: string; readonly trackedBy?: string },
): ImportItem {
	return { key, name: key, icon: undefined, kind, robloxId: asRobloxAssetId(id), trackedBy };
}

const VIP = item("gamePass", { id: "11", key: "vip-pass" });
const OLD = item("gamePass", { id: "12", key: "old", trackedBy: "old" });
const COINS = item("developerProduct", { id: "13", key: "coins" });
const GEMS = item("developerProduct", { id: "14", key: "gems", trackedBy: "gems" });
const ITEMS = [VIP, OLD, COINS, GEMS];

const CANCELLED = { err: { kind: "cancelled" }, success: false } as const;

function ok<T>(data: T): { readonly data: T; readonly success: true } {
	return { data, success: true };
}

/**
 * An import that hands `items` to the command's picker and records what it
 * chose.
 *
 * @param items - The live items the picker shows.
 * @param links - The links the planner offers for the picked Keys.
 * @returns The fake and the recorded choices.
 */
function pickingImport(
	items: ReadonlyArray<ImportItem> = ITEMS,
	links: ReadonlyArray<ImportLink> = [],
) {
	const choices: Array<Result<ImportChoice, ImportCancelled>> = [];
	const importItems = vi.fn<ImportItemsFunc>(async (options) => {
		const choice = await options.choose!(items, (selections) => {
			return links.filter((link) => {
				return selections.some(({ key, kind, robloxId }) => {
					return key === link.key && kind === link.kind && robloxId === link.robloxId;
				});
			});
		});
		choices.push(choice);
		return choice.success ? ok(EMPTY_OUTCOME) : choice;
	});
	return { choices, importItems };
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
		[{ environment: "production", select: "game-pass:11" }, "--select needs --yes"],
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

	it("should import the picked untracked items under their edited Keys and untrack the cleared ones", async ({
		expect,
	}) => {
		expect.assertions(5);

		const prompts = fakeImportPromptPort();
		vi.mocked(prompts.promptItems).mockResolvedValueOnce(ok([VIP, COINS, OLD]));
		vi.mocked(prompts.promptKeysToEdit).mockResolvedValueOnce(ok([VIP]));
		vi.mocked(prompts.promptKey).mockResolvedValueOnce(ok("vip"));
		vi.mocked(prompts.confirmImport).mockResolvedValueOnce(ok(undefined));
		const picked = pickingImport();
		const dependencies = makeDependencies({
			importItems: picked.importItems,
			importPromptPort: prompts,
		});

		await importCommand(dependencies)({ environment: "production" });

		expect(prompts.promptItems).toHaveBeenCalledExactlyOnceWith(ITEMS);
		expect(prompts.promptKeysToEdit).toHaveBeenCalledExactlyOnceWith([VIP, COINS]);
		expect(prompts.promptKey).toHaveBeenCalledExactlyOnceWith(VIP);
		expect(prompts.confirmImport).toHaveBeenCalledExactlyOnceWith({
			environment: "production",
			imports: [
				{ key: "vip", item: VIP },
				{ key: "coins", item: COINS },
			],
			links: [],
			untrack: [GEMS],
		});
		expect(picked.choices).toStrictEqual([
			ok({
				selections: [
					{ key: "vip", kind: "gamePass", robloxId: VIP.robloxId },
					{ key: "coins", kind: "developerProduct", robloxId: COINS.robloxId },
				],
				untrack: [{ kind: "developerProduct", robloxId: GEMS.robloxId }],
			}),
		]);
	});

	it("should skip the Key and summary screens when the picker changes nothing", async ({
		expect,
	}) => {
		expect.assertions(3);

		const prompts = fakeImportPromptPort();
		vi.mocked(prompts.promptItems).mockResolvedValueOnce(ok([OLD, GEMS]));
		const picked = pickingImport();
		const dependencies = makeDependencies({
			importItems: picked.importItems,
			importPromptPort: prompts,
		});

		await importCommand(dependencies)({ environment: "production" });

		expect(prompts.promptKeysToEdit).not.toHaveBeenCalled();
		expect(prompts.confirmImport).not.toHaveBeenCalled();
		expect(picked.choices).toStrictEqual([ok({ selections: [], untrack: [] })]);
	});

	it("should import a picked item under its suggested Key when every tracked item stays selected", async ({
		expect,
	}) => {
		expect.assertions(1);

		const prompts = fakeImportPromptPort();
		vi.mocked(prompts.promptItems).mockResolvedValueOnce(ok([VIP, OLD]));
		vi.mocked(prompts.promptKeysToEdit).mockResolvedValueOnce(ok([]));
		vi.mocked(prompts.confirmImport).mockResolvedValueOnce(ok(undefined));
		const picked = pickingImport([VIP, OLD]);

		await importCommand(
			makeDependencies({ importItems: picked.importItems, importPromptPort: prompts }),
		)({ environment: "production" });

		expect(picked.choices).toStrictEqual([
			ok({
				selections: [{ key: "vip-pass", kind: "gamePass", robloxId: VIP.robloxId }],
				untrack: [],
			}),
		]);
	});

	it("should ask for no Keys when only tracked items are cleared", async ({ expect }) => {
		expect.assertions(2);

		const prompts = fakeImportPromptPort();
		vi.mocked(prompts.promptItems).mockResolvedValueOnce(ok([OLD]));
		vi.mocked(prompts.confirmImport).mockResolvedValueOnce(ok(undefined));
		const picked = pickingImport();

		await importCommand(
			makeDependencies({ importItems: picked.importItems, importPromptPort: prompts }),
		)({ environment: "production" });

		expect(prompts.promptKeysToEdit).not.toHaveBeenCalled();
		expect(picked.choices).toStrictEqual([
			ok({
				selections: [],
				untrack: [{ kind: "developerProduct", robloxId: GEMS.robloxId }],
			}),
		]);
	});

	it("should say so and show no picker when the Environment has no live items", async ({
		expect,
	}) => {
		expect.assertions(3);

		const prompts = fakeImportPromptPort();
		const picked = pickingImport([]);
		const dependencies = makeDependencies({
			importItems: picked.importItems,
			importPromptPort: prompts,
		});

		await importCommand(dependencies)({ environment: "production" });

		expect(prompts.promptItems).not.toHaveBeenCalled();
		expect(dependencies.clack!.logMessage).toHaveBeenCalledExactlyOnceWith(
			'"production" has no live game passes, developer products or badges to import.',
		);
		expect(picked.choices).toStrictEqual([ok({ selections: [], untrack: [] })]);
	});

	it.for(["promptItems", "promptKeysToEdit", "promptKey", "confirmImport"] as const)(
		"should write nothing and exit 1 when %s is cancelled",
		async (screen, { expect }) => {
			expect.assertions(4);

			const prompts = fakeImportPromptPort();
			vi.mocked(prompts.promptItems).mockResolvedValueOnce(ok([VIP]));
			vi.mocked(prompts.promptKeysToEdit).mockResolvedValueOnce(ok([VIP]));
			vi.mocked(prompts.promptKey).mockResolvedValueOnce(ok("vip"));
			vi.mocked(prompts.confirmImport).mockResolvedValueOnce(ok(undefined));
			vi.mocked(prompts[screen]).mockReset().mockResolvedValueOnce(CANCELLED);
			const picked = pickingImport();
			const dependencies = makeDependencies({
				importItems: picked.importItems,
				importPromptPort: prompts,
			});

			await importCommand(dependencies)({ environment: "production" });

			expect(picked.choices).toStrictEqual([CANCELLED]);
			expect(dependencies.clack!.logError).not.toHaveBeenCalled();
			expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("import cancelled");
			expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
		},
	);

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

	it("should show one link screen per other Environment before the summary", async ({
		expect,
	}) => {
		expect.assertions(5);

		const candidates = [
			{ name: "match", differences: [], robloxId: asRobloxAssetId("21") },
			{ name: "other", differences: [], robloxId: asRobloxAssetId("98") },
		];
		const vipLink = {
			key: VIP.key,
			candidates,
			kind: VIP.kind,
			linked: undefined,
			robloxId: VIP.robloxId,
		};
		const coinsLink = {
			...vipLink,
			key: COINS.key,
			kind: COINS.kind,
			robloxId: COINS.robloxId,
		};
		const links: ReadonlyArray<ImportLink> = [
			{ ...vipLink, environment: "staging", suggested: asRobloxAssetId("21") },
			{ ...coinsLink, environment: "staging", suggested: undefined },
			{ ...vipLink, environment: "qa", suggested: asRobloxAssetId("21") },
			{ ...coinsLink, candidates: [], environment: "qa", suggested: undefined },
		];
		const prompts = fakeImportPromptPort();
		vi.mocked(prompts.promptItems).mockResolvedValueOnce(ok([VIP, COINS]));
		vi.mocked(prompts.promptKeysToEdit).mockResolvedValueOnce(ok([]));
		vi.mocked(prompts.promptLinksToEdit)
			.mockImplementationOnce(async ({ links: screen }) => ok([screen[1]!]))
			.mockImplementationOnce(async ({ links: screen }) => ok([screen[0]!]));
		vi.mocked(prompts.promptLink)
			.mockResolvedValueOnce(ok(asRobloxAssetId("98")))
			.mockResolvedValueOnce(ok(undefined));
		vi.mocked(prompts.confirmImport).mockResolvedValueOnce(ok(undefined));
		const picked = pickingImport([VIP, COINS], links);

		await importCommand(
			makeDependencies({ importItems: picked.importItems, importPromptPort: prompts }),
		)({ environment: "production" });

		expect(prompts.promptLinksToEdit).toHaveBeenNthCalledWith(1, {
			environment: "staging",
			links: [
				{ item: VIP, link: links[0] },
				{ item: COINS, link: links[1] },
			],
		});
		expect(prompts.promptLinksToEdit).toHaveBeenNthCalledWith(2, {
			environment: "qa",
			links: [
				{ item: VIP, link: links[2] },
				{ item: COINS, link: links[3] },
			],
		});
		expect(vi.mocked(prompts.promptLink).mock.calls).toStrictEqual([
			[{ item: COINS, link: links[1] }],
			[{ item: VIP, link: links[2] }],
		]);
		expect(vi.mocked(prompts.confirmImport).mock.calls[0]![0].links).toStrictEqual([
			{ item: VIP, link: { ...links[0], linked: "21" } },
			{ item: COINS, link: { ...links[1], linked: "98" } },
			{ item: VIP, link: { ...links[2], linked: undefined } },
			{ item: COINS, link: { ...links[3], linked: undefined } },
		]);
		expect(picked.choices).toStrictEqual([
			ok({
				selections: [
					{ key: "vip-pass", kind: "gamePass", links: { staging: "21" }, robloxId: "11" },
					{
						key: "coins",
						kind: "developerProduct",
						links: { staging: "98" },
						robloxId: "13",
					},
				],
				untrack: [],
			}),
		]);
	});

	it("should skip a link screen with no candidates and cancel on a cancelled link screen", async ({
		expect,
	}) => {
		expect.assertions(3);

		const empty: ImportLink = {
			key: VIP.key,
			candidates: [],
			environment: "staging",
			kind: VIP.kind,
			linked: undefined,
			robloxId: VIP.robloxId,
			suggested: undefined,
		};
		const withCandidate = {
			...empty,
			candidates: [{ name: "x", differences: [], robloxId: asRobloxAssetId("21") }],
		};
		async function run(links: ReadonlyArray<ImportLink>, port = fakeImportPromptPort()) {
			vi.mocked(port.promptItems).mockResolvedValueOnce(ok([VIP]));
			vi.mocked(port.promptKeysToEdit).mockResolvedValueOnce(ok([]));
			vi.mocked(port.confirmImport).mockResolvedValueOnce(ok(undefined));
			const picked = pickingImport([VIP], links);
			await importCommand(
				makeDependencies({ importItems: picked.importItems, importPromptPort: port }),
			)({ environment: "production" });
			return { picked, port };
		}

		const skipped = await run([empty]);
		const cancelledScreen = fakeImportPromptPort();
		vi.mocked(cancelledScreen.promptLinksToEdit).mockResolvedValueOnce(CANCELLED);
		const cancelledLink = fakeImportPromptPort();
		vi.mocked(cancelledLink.promptLinksToEdit).mockImplementationOnce(async (screen) => {
			return ok(screen.links);
		});
		vi.mocked(cancelledLink.promptLink).mockResolvedValueOnce(CANCELLED);
		const screen = await run([withCandidate], cancelledScreen);
		const linkPrompt = await run([withCandidate], cancelledLink);

		expect(skipped.port.promptLinksToEdit).not.toHaveBeenCalled();
		expect(skipped.picked.choices).toStrictEqual([
			ok({
				selections: [{ key: "vip-pass", kind: "gamePass", robloxId: "11" }],
				untrack: [],
			}),
		]);
		expect([...screen.picked.choices, ...linkPrompt.picked.choices]).toStrictEqual([
			CANCELLED,
			CANCELLED,
		]);
	});

	it("should pass --link to the import and report each link", async ({ expect }) => {
		expect.assertions(2);

		const base = {
			candidates: [
				{
					name: "[STAGING] VIP",
					differences: [
						{ config: "VIP", field: "name", live: "[STAGING] VIP" },
						{ config: 1, field: "price", live: 2 },
					],
					robloxId: asRobloxAssetId("21"),
				},
				{ name: "Gold", differences: [], robloxId: asRobloxAssetId("22") },
			],
			environment: "staging",
			kind: "gamePass",
			robloxId: PASS_ID,
			suggested: undefined,
		} as const;
		const dependencies = makeDependencies({
			importItems: fakeImport({
				data: {
					links: [
						{ ...base, key: "a", linked: asRobloxAssetId("21") },
						{ ...base, key: "b", linked: asRobloxAssetId("22") },
						{ ...base, key: "c", linked: undefined },
					],
				},
				success: true,
			}),
		});

		await importCommand(dependencies)({ ...SELECT, link: "auto" });

		expect(vi.mocked(dependencies.importItems!).mock.calls[0]![0].link).toBe("auto");
		expect(vi.mocked(dependencies.clack!.logMessage).mock.calls).toStrictEqual([
			[
				'gamePass:a is linked in "staging" to id 21 "[STAGING] VIP". The next deploy there changes name, price to the config values.',
			],
			['gamePass:b is linked in "staging" to id 22 "Gold".'],
			['gamePass:c is not linked in "staging": the next deploy there creates it.'],
		]);
	});

	it("should warn that the next deploy of a redacted Environment replaces the imports", async ({
		expect,
	}) => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			importItems: fakeImport({
				data: { redacted: ["gamePass:vip-pass", "badge:first-win"] },
				success: true,
			}),
		});

		await importCommand(dependencies)(SELECT);

		expect(vi.mocked(dependencies.clack!.logMessage).mock.calls).toStrictEqual([
			[
				'"production" is redacted: its next deploy replaces the live name, description, icon and price of gamePass:vip-pass, badge:first-win with placeholders.',
			],
		]);
	});

	it("should refuse --link without --yes", async ({ expect }) => {
		expect.assertions(2);

		const dependencies = makeDependencies();

		await importCommand(dependencies)({ environment: "production", link: "auto" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"--link needs --yes; the picker asks for each link instead.",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should put each link on the screen of the item with its Kind and id", async ({
		expect,
	}) => {
		expect.assertions(1);

		const pass13 = item("gamePass", { id: "13", key: "speed" });
		const pass14 = item("gamePass", { id: "14", key: "gold" });
		const link: ImportLink = {
			key: pass13.key,
			candidates: [{ name: "x", differences: [], robloxId: asRobloxAssetId("21") }],
			environment: "staging",
			kind: pass13.kind,
			linked: undefined,
			robloxId: pass13.robloxId,
			suggested: undefined,
		};
		const prompts = fakeImportPromptPort();
		vi.mocked(prompts.promptItems).mockResolvedValueOnce(ok([COINS, pass14, pass13]));
		vi.mocked(prompts.promptKeysToEdit).mockResolvedValueOnce(ok([]));
		vi.mocked(prompts.promptLinksToEdit).mockResolvedValueOnce(ok([]));
		vi.mocked(prompts.confirmImport).mockResolvedValueOnce(ok(undefined));
		const picked = pickingImport([COINS, pass14, pass13], [link]);

		await importCommand(
			makeDependencies({ importItems: picked.importItems, importPromptPort: prompts }),
		)({ environment: "production" });

		expect(prompts.promptLinksToEdit).toHaveBeenCalledExactlyOnceWith({
			environment: "staging",
			links: [{ item: pass13, link }],
		});
	});
});
