import { describe, it } from "vitest";

import { type ConfigEdit, editConfigText } from "./edit-config.ts";

const ADD_GEMS: ConfigEdit = {
	key: "gems",
	collection: "products",
	entry: { name: "Gems", price: 25 },
	kind: "addEntry",
};

const IMPORT_VIP: ConfigEdit = {
	key: "vip",
	collection: "passes",
	environment: "production",
	iconBaseline: "accept-local-file",
	importId: "42",
	kind: "declareImport",
};

const IMPORT_PLAIN: ConfigEdit = {
	key: "vip",
	collection: "passes",
	environment: "production",
	importId: "42",
	kind: "declareImport",
};

const UNTRACK_VIP: ConfigEdit = { key: "vip", collection: "passes", kind: "untrack" };

function editYaml(text: string, edits: ReadonlyArray<ConfigEdit>) {
	return editConfigText({ edits, fileName: "bedrock.config.yaml", text });
}

describe(editConfigText, () => {
	describe("yaml", () => {
		it("should append a new root entry to an existing block collection", ({ expect }) => {
			expect.assertions(2);

			const result = editYaml(
				'products:\n  coins:\n    name: Coins # cheap\n\nuniverse:\n  universeId: "1"\n',
				[ADD_GEMS],
			);

			expect(result.text).toBe(
				'products:\n  coins:\n    name: Coins # cheap\n  gems:\n    name: Gems\n    price: 25\n\nuniverse:\n  universeId: "1"\n',
			);
			expect(result.outcomes).toStrictEqual([{ edit: ADD_GEMS, status: "written" }]);
		});

		it("should create a missing collection with the file's indentation", ({ expect }) => {
			expect.assertions(1);

			const result = editYaml('universe:\n    universeId: "1"', [
				{
					key: "gold",
					collection: "badges",
					entry: { name: "Gold", enabled: true, icon: { "en-us": "gold.png" }, tags: {} },
					kind: "addEntry",
				},
			]);

			expect(result.text).toBe(
				'universe:\n    universeId: "1"\nbadges:\n    gold:\n        name: Gold\n        enabled: true\n        icon:\n            en-us: gold.png\n        tags: {}\n',
			);
		});

		it("should quote a string that would read as another type", ({ expect }) => {
			expect.assertions(1);

			const result = editYaml("environments:\n  production:\n    places: {}\n", [IMPORT_VIP]);

			expect(result.text).toBe(
				'environments:\n  production:\n    places: {}\n    passes:\n      vip:\n        iconBaseline: accept-local-file\n        importId: "42"\n',
			);
		});

		it("should add import lines to an existing overlay entry", ({ expect }) => {
			expect.assertions(1);

			const result = editYaml(
				"environments:\n  production:\n    passes:\n      vip:\n        price: 5\n",
				[IMPORT_PLAIN],
			);

			expect(result.text).toBe(
				'environments:\n  production:\n    passes:\n      vip:\n        price: 5\n        importId: "42"\n',
			);
		});

		it("should write members into a flow mapping on one line", ({ expect }) => {
			expect.assertions(2);

			const result = editYaml("environments:\n  production: {passes: {}}\n", [
				IMPORT_VIP,
				{ ...IMPORT_PLAIN, key: "boost" },
			]);

			expect(result.text).toBe(
				'environments:\n  production: {passes: { "vip": { "iconBaseline": "accept-local-file", "importId": "42" }, "boost": { "importId": "42" } }}\n',
			);
			expect(result.outcomes.map((outcome) => outcome.status)).toStrictEqual([
				"written",
				"written",
			]);
		});

		it("should write after a flow key that has no value", ({ expect }) => {
			expect.assertions(1);

			const result = editYaml("passes: {vip}\n", [
				{ key: "gold", collection: "passes", entry: { name: "Gold" }, kind: "addEntry" },
			]);

			expect(result.text).toBe('passes: {vip, "gold": { "name": "Gold" }}\n');
		});

		it("should replace a block entry with the untrack marker", ({ expect }) => {
			expect.assertions(1);

			const result = editYaml(
				"passes:\n  vip:\n    name: VIP\n    price: 5\n  other:\n    name: Other\n",
				[UNTRACK_VIP],
			);

			expect(result.text).toBe(
				"passes:\n  vip:\n    retired: untrack\n  other:\n    name: Other\n",
			);
		});

		it("should replace a flow entry and an overlay entry with the untrack marker", ({
			expect,
		}) => {
			expect.assertions(1);

			const result = editYaml(
				"passes:\n  vip: {name: VIP}\nenvironments:\n  production:\n    passes:\n      vip:\n        price: 5",
				[UNTRACK_VIP, { ...UNTRACK_VIP, environment: "production" }],
			);

			expect(result.text).toBe(
				'passes:\n  vip: { "retired": "untrack" }\nenvironments:\n  production:\n    passes:\n      vip:\n        retired: untrack',
			);
		});

		it("should refuse edits the file contradicts", ({ expect }) => {
			expect.assertions(2);

			const text =
				'passes:\n  vip:\n    name: VIP\nenvironments:\n  production:\n    passes:\n      vip:\n        importId: "7"\n';
			const result = editYaml(text, [
				{
					key: "vip",
					collection: "passes",
					entry: { description: "New" },
					kind: "addEntry",
				},
				IMPORT_VIP,
				{ ...UNTRACK_VIP, key: "missing" },
				{ ...UNTRACK_VIP, collection: "badges" },
			]);

			expect(result.text).toBe(text);
			expect(result.outcomes).toStrictEqual([
				expect.objectContaining({ reason: "conflict" }),
				expect.objectContaining({ reason: "conflict" }),
				expect.objectContaining({ reason: "conflict" }),
				expect.objectContaining({ reason: "conflict" }),
			]);
		});

		it("should return paste text for a location behind an alias or merge key", ({ expect }) => {
			expect.assertions(2);

			const text =
				"base: &base\n  name: VIP\npasses:\n  vip: *base\n  anchored: &a\n    name: A\nproducts:\n  <<: {coins: {name: Coins}}\n";
			const result = editYaml(text, [
				ADD_GEMS,
				{ ...IMPORT_VIP, key: "x", environment: "production" },
				UNTRACK_VIP,
				{ ...UNTRACK_VIP, key: "anchored" },
			]);

			expect(result.text).toBe(
				`${text}environments:\n  production:\n    passes:\n      x:\n        iconBaseline: accept-local-file\n        importId: "42"\n`,
			);
			expect(result.outcomes).toStrictEqual([
				{
					edit: ADD_GEMS,
					paste: { path: ["products"], text: "gems:\n  name: Gems\n  price: 25" },
					reason: "notLiteral",
					status: "notSafe",
				},
				{ edit: { ...IMPORT_VIP, key: "x", environment: "production" }, status: "written" },
				expect.objectContaining({ reason: "notLiteral" }),
				expect.objectContaining({ reason: "notLiteral" }),
			]);
		});

		it("should return paste text when a location holds a scalar or nothing", ({ expect }) => {
			expect.assertions(1);

			const result = editYaml("environments: 5\nproducts: 5\n", [IMPORT_VIP, ADD_GEMS]);

			expect(result.outcomes).toStrictEqual([
				expect.objectContaining({ reason: "notLiteral" }),
				expect.objectContaining({
					paste: { path: ["products"], text: "gems:\n  name: Gems\n  price: 25" },
					reason: "notLiteral",
				}),
			]);
		});

		it("should indent by two spaces and keep a long string on one line in a flat file", ({
			expect,
		}) => {
			expect.assertions(1);

			const description = "word ".repeat(30).trim();
			const result = editYaml("universe: 1\n", [
				{ key: "vip", collection: "passes", entry: { description }, kind: "addEntry" },
			]);

			expect(result.text).toBe(
				`universe: 1\npasses:\n  vip:\n    description: ${description}\n`,
			);
		});

		it("should write after a flow mapping's trailing comma", ({ expect }) => {
			expect.assertions(1);

			const result = editYaml("products: {coins: {name: C} ,}\n", [
				{ ...ADD_GEMS, entry: { name: "Gems", tags: {} } },
			]);

			expect(result.text).toBe(
				'products: {coins: {name: C} , "gems": { "name": "Gems", "tags": {} },}\n',
			);
		});

		it("should write several fields into flow mappings on one line", ({ expect }) => {
			expect.assertions(1);

			const result = editYaml(
				"environments: {production: {passes: {vip: {price: 5}}}, staging: {passes: {vip: {}}}}\n",
				[IMPORT_VIP, { ...IMPORT_VIP, environment: "staging" }],
			);

			expect(result.text).toBe(
				'environments: {production: {passes: {vip: {price: 5, "iconBaseline": "accept-local-file", "importId": "42"}}}, staging: {passes: {vip: { "iconBaseline": "accept-local-file", "importId": "42" }}}}\n',
			);
		});

		it("should return every edit as not safe when the file does not parse", ({ expect }) => {
			expect.assertions(1);

			const result = editYaml("passes: [\n", [ADD_GEMS]);

			expect(result.outcomes).toStrictEqual([
				expect.objectContaining({ reason: "notLiteral" }),
			]);
		});
	});

	describe("json", () => {
		function editJson(text: string, edits: ReadonlyArray<ConfigEdit>) {
			return editConfigText({ edits, fileName: "bedrock.config.json", text });
		}

		it("should append entries in the file's layout without a trailing comma", ({ expect }) => {
			expect.assertions(1);

			const result = editJson(
				'{\n  "products": {\n    "coins": { "name": "Coins" }\n  }\n}\n',
				[
					ADD_GEMS,
					{
						...ADD_GEMS,
						key: "bars",
						entry: { icon: { "en-us": "bars.png" }, tags: {} },
					},
				],
			);

			expect(result.text).toBe(
				'{\n  "products": {\n    "coins": { "name": "Coins" },\n    "gems": {\n      "name": "Gems",\n      "price": 25\n    },\n    "bars": {\n      "icon": {\n        "en-us": "bars.png"\n      },\n      "tags": {}\n    }\n  }\n}\n',
			);
		});

		it("should keep a trailing comma style the file already uses", ({ expect }) => {
			expect.assertions(1);

			const result = editJson('{\n  "products": {\n    "coins": 1,\n  }\n}\n', [ADD_GEMS]);

			expect(result.text).toBe(
				'{\n  "products": {\n    "coins": 1,\n    "gems": {\n      "name": "Gems",\n      "price": 25,\n    },\n  }\n}\n',
			);
		});

		it("should write several fields on their own lines", ({ expect }) => {
			expect.assertions(1);

			const result = editJson(
				'{\n"environments": {\n"production": {\n"passes": {\n"vip": {\n"price": 5\n}\n}\n}\n}\n}\n',
				[IMPORT_VIP],
			);

			expect(result.text).toBe(
				'{\n"environments": {\n"production": {\n"passes": {\n"vip": {\n"price": 5,\n"iconBaseline": "accept-local-file",\n"importId": "42"\n}\n}\n}\n}\n}\n',
			);
		});

		it("should expand an empty object with tabs in a file with no indentation", ({
			expect,
		}) => {
			expect.assertions(1);

			const result = editJson('{"environments": {"production": {"passes": {"vip": {}}}}}', [
				IMPORT_VIP,
			]);

			expect(result.text).toBe(
				'{"environments": {"production": {"passes": {"vip": {\n\t"iconBaseline": "accept-local-file",\n\t"importId": "42"\n}}}}}',
			);
		});

		it("should expand an empty object and create missing parents", ({ expect }) => {
			expect.assertions(1);

			const result = editJson('{\n\t"environments": {}\n}', [IMPORT_VIP]);

			expect(result.text).toBe(
				'{\n\t"environments": {\n\t\t"production": {\n\t\t\t"passes": {\n\t\t\t\t"vip": {\n\t\t\t\t\t"iconBaseline": "accept-local-file",\n\t\t\t\t\t"importId": "42"\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}',
			);
		});

		it("should write into a one-line object on that line", ({ expect }) => {
			expect.assertions(1);

			const result = editJson('{ "passes": { "vip": { "price": 5 } } }', [
				{ ...IMPORT_VIP, environment: "staging" },
				UNTRACK_VIP,
			]);

			expect(result.text).toBe(
				'{ "passes": { "vip": { "retired": "untrack" } }, "environments": { "staging": { "passes": { "vip": { "iconBaseline": "accept-local-file", "importId": "42" } } } } }',
			);
		});

		it("should return paste text as a JSON member", ({ expect }) => {
			expect.assertions(1);

			const result = editJson('{\n  "products": 5\n}\n', [ADD_GEMS]);

			expect(result.outcomes).toStrictEqual([
				{
					edit: ADD_GEMS,
					paste: {
						path: ["products"],
						text: '"gems": {\n  "name": "Gems",\n  "price": 25\n}',
					},
					reason: "notLiteral",
					status: "notSafe",
				},
			]);
		});
	});

	it("should return paste text as JSON for a format it cannot parse", ({ expect }) => {
		expect.assertions(2);

		const text = "[products.coins]\nname = 'Coins'\n";
		const result = editConfigText({ edits: [ADD_GEMS], fileName: ".bedrockrc.TOML", text });

		expect(result.text).toBe(text);
		expect(result.outcomes).toStrictEqual([
			{
				edit: ADD_GEMS,
				paste: {
					path: ["products"],
					text: '"gems": {\n\t"name": "Gems",\n\t"price": 25\n}',
				},
				reason: "notLiteral",
				status: "notSafe",
			},
		]);
	});

	it("should read the extension without regard to case", ({ expect }) => {
		expect.assertions(1);

		const result = editConfigText({
			edits: [ADD_GEMS],
			fileName: "bedrock.config.YML",
			text: "products: {}\n",
		});

		expect(result.outcomes).toStrictEqual([{ edit: ADD_GEMS, status: "written" }]);
	});

	describe("typescript and javascript", () => {
		function editScript(text: string, edits: ReadonlyArray<ConfigEdit>) {
			return editConfigText({ edits, fileName: "bedrock.config.ts", text });
		}

		it("should write into a defineConfig object in the file's style", ({ expect }) => {
			expect.assertions(1);

			const text = [
				'import { defineConfig } from "@bedrock-rbx/core/config";',
				"",
				"// Shop config.",
				"export default defineConfig({",
				"\tpasses: {",
				'\t\tvip: { name: "VIP" }, // best seller',
				"\t},",
				"} satisfies object);",
				"",
			].join("\n");
			const result = editScript(text, [
				{
					key: "gold",
					collection: "passes",
					entry: { name: "Gold", icon: { "en-us": "gold.png" } },
					kind: "addEntry",
				},
				IMPORT_VIP,
				UNTRACK_VIP,
			]);

			expect(result.text).toBe(
				[
					'import { defineConfig } from "@bedrock-rbx/core/config";',
					"",
					"// Shop config.",
					"export default defineConfig({",
					"\tpasses: {",
					'\t\tvip: { retired: "untrack" }, // best seller',
					"\t\tgold: {",
					'\t\t\tname: "Gold",',
					"\t\t\ticon: {",
					'\t\t\t\t"en-us": "gold.png",',
					"\t\t\t},",
					"\t\t},",
					"\t},",
					"\tenvironments: {",
					"\t\tproduction: {",
					"\t\t\tpasses: {",
					"\t\t\t\tvip: {",
					'\t\t\t\t\ticonBaseline: "accept-local-file",',
					'\t\t\t\t\timportId: "42",',
					"\t\t\t\t},",
					"\t\t\t},",
					"\t\t},",
					"\t},",
					"} satisfies object);",
					"",
				].join("\n"),
			);
		});

		it("should follow a const to its object and keep a file without trailing commas", ({
			expect,
		}) => {
			expect.assertions(1);

			const result = editConfigText({
				edits: [ADD_GEMS, { ...UNTRACK_VIP, key: "coins", collection: "products" }],
				fileName: "bedrock.config.js",
				text: 'const config = {\n  products: {\n    "coins": { name: "Coins" }\n  }\n};\n\nexport default config;\n',
			});

			expect(result.text).toBe(
				'const config = {\n  products: {\n    "coins": { retired: "untrack" },\n    gems: {\n      name: "Gems",\n      price: 25\n    }\n  }\n};\n\nexport default config;\n',
			);
		});

		it("should follow the exported name to its own const", ({ expect }) => {
			expect.assertions(1);

			const result = editScript(
				"const other = {};\nconst config = { products: {} };\nexport default config;\n",
				[{ ...ADD_GEMS, entry: { name: "Gems" } }],
			);

			expect(result.text).toBe(
				'const other = {};\nconst config = { products: {\n\tgems: {\n\t\tname: "Gems",\n\t},\n} };\nexport default config;\n',
			);
		});

		it("should expand an empty object assigned to module.exports", ({ expect }) => {
			expect.assertions(1);

			const result = editConfigText({
				edits: [ADD_GEMS],
				fileName: "bedrock.config.cjs",
				text: 'console.log("config");\nmodule.exports = { products: {} };\n',
			});

			expect(result.text).toBe(
				'console.log("config");\nmodule.exports = { products: {\n\tgems: {\n\t\tname: "Gems",\n\t\tprice: 25,\n\t},\n} };\n',
			);
		});

		it("should write on one line after a trailing comma inside parentheses and as", ({
			expect,
		}) => {
			expect.assertions(1);

			const result = editScript("export default ({ passes: { vip: {}, }, }) as const;\n", [
				{ key: "gold", collection: "passes", entry: { name: "Gold" }, kind: "addEntry" },
			]);

			expect(result.text).toBe(
				'export default ({ passes: { vip: {}, gold: { name: "Gold" }, }, }) as const;\n',
			);
		});

		it("should write on the last member's line when the brace closes there", ({ expect }) => {
			expect.assertions(1);

			const result = editScript("export default {\n\tproducts: {\n\t\tcoins: 1 }\n};\n", [
				ADD_GEMS,
			]);

			expect(result.text).toBe(
				'export default {\n\tproducts: {\n\t\tcoins: 1, gems: { name: "Gems", price: 25 } }\n};\n',
			);
		});

		it("should write the literal entries of a partly computed config", ({ expect }) => {
			expect.assertions(2);

			const text = [
				'const shared = { name: "Shared" };',
				"",
				"export default {",
				"\tpasses: {",
				"\t\t...extraPasses,",
				"\t\tvip: shared,",
				"\t},",
				"\tproducts: {",
				'\t\tcoins: { name: "Coins", get price() { return 5; } },',
				'\t\t[dynamicKey]: { name: "X" },',
				"\t},",
				"\tbadges: makeBadges(),",
				"\tenvironments: {",
				"\t\tproduction: {",
				"\t\t\tpasses: {",
				"\t\t\t\tvip: { price: 5 },",
				"\t\t\t},",
				"\t\t},",
				"\t},",
				"};",
				"",
			].join("\n");
			const gold: ConfigEdit = {
				key: "gold",
				collection: "passes",
				entry: { name: "Gold" },
				kind: "addEntry",
			};
			const result = editScript(text, [
				gold,
				ADD_GEMS,
				{ ...ADD_GEMS, collection: "badges" },
				IMPORT_VIP,
				{ ...UNTRACK_VIP, key: "coins", collection: "products" },
				{ ...IMPORT_PLAIN, key: "coins", collection: "products", environment: "staging" },
			]);

			expect(result.text).toBe(
				text
					.replace(
						"vip: { price: 5 },",
						'vip: { price: 5, iconBaseline: "accept-local-file", importId: "42" },',
					)
					.replace(
						"\t\t},\n\t},\n};",
						'\t\t},\n\t\tstaging: {\n\t\t\tproducts: {\n\t\t\t\tcoins: {\n\t\t\t\t\timportId: "42",\n\t\t\t\t},\n\t\t\t},\n\t\t},\n\t},\n};',
					),
			);
			expect(result.outcomes).toStrictEqual([
				{
					edit: gold,
					paste: { path: ["passes"], text: 'gold: {\n\tname: "Gold",\n},' },
					reason: "notLiteral",
					status: "notSafe",
				},
				expect.objectContaining({ reason: "notLiteral" }),
				expect.objectContaining({ reason: "notLiteral" }),
				expect.objectContaining({ status: "written" }),
				expect.objectContaining({ reason: "notLiteral" }),
				expect.objectContaining({ status: "written" }),
			]);
		});

		it.for([
			"export default function () {\n\treturn {};\n}\n",
			"export default {",
			'import config from "./config";\nexport default config;\n',
			"let config = { products: {} };\nexport default config;\n",
			"export default defineConfig();\n",
			"export default build({ products: {} });\n",
			"module.exports.products = {};\n",
			"const products = {};\n",
			"export default { products: {} };\nreturn;\n",
		])(
			"should return paste text when no literal config object is found: %s",
			(text, { expect }) => {
				expect.assertions(1);

				const result = editScript(text, [ADD_GEMS]);

				expect(result.outcomes).toStrictEqual([
					expect.objectContaining({ reason: "notLiteral" }),
				]);
			},
		);
	});
});
