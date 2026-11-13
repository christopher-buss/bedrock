import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it, type TestContext } from "vitest";

import { type ConfigEdit, editConfigText } from "#src/core/config-editor/edit-config";
import { loadConfig } from "#src/index";

const ADD_GOLD: ConfigEdit = {
	key: "gold",
	collection: "passes",
	entry: { name: "Gold", description: "Shiny", icon: { "en-us": "gold.png" }, price: 100 },
	kind: "addEntry",
};

const ADD_FIRST: ConfigEdit = {
	key: "first",
	collection: "badges",
	entry: { name: "First", description: "Joined", icon: { "en-us": "first.png" } },
	kind: "addEntry",
};

const UNTRACK_COINS: ConfigEdit = { key: "coins", collection: "products", kind: "untrack" };

function importPass(key: string): ConfigEdit {
	return {
		key,
		collection: "passes",
		environment: "production",
		iconBaseline: "accept-local-file",
		importId: "9876",
		kind: "declareImport",
	};
}

async function readFixture(directory: string, fileName: string): Promise<string> {
	return readFile(
		fileURLToPath(new URL(`fixtures/config-editor/${directory}/${fileName}`, import.meta.url)),
		"utf8",
	);
}

async function loadEdited(
	{ fileName, text }: { readonly fileName: string; readonly text: string },
	onTestFinished: TestContext["onTestFinished"],
) {
	const cwd = await mkdtemp(join(tmpdir(), "bedrock-config-editor-"));
	onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
	await writeFile(join(cwd, fileName), text);
	const loaded = await loadConfig({ cwd });
	assert(loaded.success, JSON.stringify(loaded));
	return loaded.data;
}

describe("config editor on config files", () => {
	it.for([
		{ directory: "yaml", fileName: "bedrock.config.yaml" },
		{ directory: "json", fileName: "bedrock.config.json" },
		{ directory: "javascript", fileName: "bedrock.config.js" },
		{ directory: "typescript", fileName: "bedrock.config.ts" },
	])(
		"should write every edit into a literal $directory config that still loads",
		async ({ directory, fileName }, { expect, onTestFinished }) => {
			expect.assertions(3);

			const text = await readFixture(directory, fileName);
			const edits = [ADD_GOLD, ADD_FIRST, importPass("gold"), UNTRACK_COINS];
			const result = editConfigText({ edits, fileName, text });

			expect(result.outcomes.map(({ status }) => status)).toStrictEqual([
				"written",
				"written",
				"written",
				"written",
			]);
			await expect(result.text).toMatchFileSnapshot(
				`fixtures/config-editor/${directory}/edited.snap`,
			);

			const config = await loadEdited({ fileName, text: result.text }, onTestFinished);

			expect(config).toMatchObject({
				badges: { first: { name: "First", description: "Joined" } },
				environments: {
					production: {
						passes: {
							gold: { iconBaseline: "accept-local-file", importId: "9876" },
							vip: { price: 50 },
						},
					},
				},
				passes: {
					gold: {
						name: "Gold",
						description: "Shiny",
						icon: { "en-us": "gold.png" },
						price: 100,
					},
					vip: { name: "VIP", description: "Perks" },
				},
				products: { coins: { retired: "untrack" } },
			});
		},
	);

	it("should write the literal entries of a partly computed config and return the rest", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(3);

		const fileName = "bedrock.config.ts";
		const text = await readFixture("typescript-computed", fileName);
		const result = editConfigText({
			edits: [ADD_GOLD, ADD_FIRST, importPass("vip"), UNTRACK_COINS],
			fileName,
			text,
		});

		expect(result.outcomes).toStrictEqual([
			{
				edit: ADD_GOLD,
				paste: {
					path: ["passes"],
					text: 'gold: {\n\tname: "Gold",\n\tdescription: "Shiny",\n\ticon: {\n\t\t"en-us": "gold.png",\n\t},\n\tprice: 100,\n},',
				},
				reason: "notLiteral",
				status: "notSafe",
			},
			{ edit: ADD_FIRST, status: "written" },
			{ edit: importPass("vip"), status: "written" },
			{ edit: UNTRACK_COINS, status: "written" },
		]);
		await expect(result.text).toMatchFileSnapshot(
			"fixtures/config-editor/typescript-computed/edited.snap",
		);

		const config = await loadEdited({ fileName, text: result.text }, onTestFinished);

		expect(config).toMatchObject({
			badges: { first: { name: "First" } },
			environments: {
				production: {
					passes: {
						vip: { iconBaseline: "accept-local-file", importId: "9876", price: 50 },
					},
				},
			},
			products: { coins: { retired: "untrack" } },
		});
	});

	it("should return every edit to a Luau config as paste text", async ({ expect }) => {
		expect.assertions(2);

		const fileName = "bedrock.config.luau";
		const text = await readFixture("luau", fileName);
		const result = editConfigText({
			edits: [ADD_GOLD, importPass("gold"), UNTRACK_COINS],
			fileName,
			text,
		});

		expect(result.text).toBe(text);
		expect(result.outcomes).toStrictEqual([
			expect.objectContaining({
				paste: {
					path: ["passes"],
					text: 'gold = {\n\tname = "Gold",\n\tdescription = "Shiny",\n\ticon = {\n\t\t["en-us"] = "gold.png",\n\t},\n\tprice = 100,\n},',
				},
				reason: "notLiteral",
			}),
			expect.objectContaining({
				paste: {
					path: ["environments", "production", "passes"],
					text: 'gold = {\n\ticonBaseline = "accept-local-file",\n\timportId = "9876",\n},',
				},
				reason: "notLiteral",
			}),
			expect.objectContaining({
				paste: { path: ["products"], text: 'coins = {\n\tretired = "untrack",\n},' },
				reason: "notLiteral",
			}),
		]);
	});
});
