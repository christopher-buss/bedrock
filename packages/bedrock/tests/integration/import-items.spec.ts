import {
	asRobloxAssetId,
	createBadgeDriver,
	createDeveloperProductDriver,
	createGamePassDriver,
	deploy,
	type DriverRegistry,
} from "@bedrock-rbx/core";
import { AssetsClient } from "@bedrock-rbx/ocale/assets";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
	validDeveloperProductBody,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import type { ImportItem } from "#src/core/import-plan-types";
import type { Config } from "#src/core/schema";
import type { BedrockState } from "#src/core/state";
import { importItemsAsync } from "#src/shell/import-items";
import { environmentFrom } from "#tests/helpers/environment";
import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const ICON = new Uint8Array([137, 80, 78, 71, 7]);
const LOCATION = { body: { location: "https://cdn.example.test/v1/bytes/icon" }, status: 200 };
const PASS_ID = asRobloxAssetId("9876543210");
const BADGE_ID = asRobloxAssetId("2468013579");
const CONFIG_FILE = "bedrock.config.json";

const CONFIG = {
	environments: { production: {}, staging: {} },
	state: { backend: "gist", gistId: "abc" },
	universe: { universeId: "123" },
} satisfies Config;

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

interface Setup {
	readonly config?: Config;
	readonly configFile?: string;
	readonly http: FakeHttpClient;
	readonly initial?: Readonly<Record<string, BedrockState>>;
	readonly refuseRead?: boolean;
	readonly text?: string;
}

/**
 * Real Drivers on the fake client. Products and badges have no list, so the
 * live check lists game passes alone.
 *
 * @param http - Fake client that answers every Open Cloud call.
 * @returns Drivers that read and download through `http`.
 */
function registryFor(http: FakeHttpClient): DriverRegistry {
	const options = {
		credential: { apiKey: "fake", kind: "apiKey" as const },
		httpClient: http,
		sleep: async () => {},
	};
	const shared = {
		assets: new AssetsClient({ ...options, fetch: async () => new Response(ICON) }),
		readFile: async () => new Uint8Array(),
		universeId: asRobloxAssetId("123"),
	};
	const { list: _badgeList, ...badge } = createBadgeDriver({
		...shared,
		client: new BadgesClient(options),
		universes: new UniversesClient(options),
	});
	const { list: _productList, ...developerProduct } = createDeveloperProductDriver({
		...shared,
		client: new DeveloperProductsClient(options),
	});
	return {
		badge,
		developerProduct,
		gamePass: createGamePassDriver({ ...shared, client: new GamePassesClient(options) }),
		place: trap,
		universe: trap,
	};
}

/**
 * Drivers with no list for any Kind, so the Environment counts as not
 * checked and links nothing.
 *
 * @returns Drivers that never call Roblox.
 */
function unlistedRegistry(): DriverRegistry {
	const registry = registryFor(createFakeHttpClient());
	const { list: _list, ...gamePass } = registry.gamePass;
	return { ...registry, gamePass };
}

function passBody() {
	return validGamePassBody({
		name: "VIP Pass",
		description: "Grants VIP perks.",
		gamePassId: Number(PASS_ID),
		iconAssetId: 1_122_334_455,
		priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
	});
}

function passList() {
	// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
	return { body: { gamePasses: [passBody()], nextPageToken: null }, status: 200 };
}

/**
 * A list page of one game pass in another universe.
 *
 * @param name - What Roblox shows for the pass.
 * @param id - Number the list reports for the pass.
 * @returns A terminal list page holding that pass.
 */
function otherPassList(name: string, id: number) {
	const pass = validGamePassBody({
		name,
		description: "Grants VIP perks.",
		gamePassId: id,
		iconAssetId: 1_122_334_456,
		priceInformation: { defaultPriceInRobux: 400, enabledFeatures: [] },
	});
	// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
	return { body: { gamePasses: [pass], nextPageToken: null }, status: 200 };
}

function badgeBody() {
	const { awarder: _awarder, ...badge } = validBadgeBody({
		id: Number(BADGE_ID),
		name: "First Win",
		description: "Win.",
		enabled: false,
		iconImageId: 1_357_924_680,
	});
	return { ...badge, awardingUniverse: { id: 123, name: "Game", rootPlaceId: 456 } };
}

/**
 * Read back an edited config without its universe, whose Driver these tests
 * do not fake.
 *
 * @param text - The edited JSON config.
 * @returns The config to deploy.
 */
function withoutUniverse(text: string): Config {
	const parsed: unknown = JSON.parse(text);
	// eslint-disable-next-line ts/no-unsafe-type-assertion -- the import wrote this config from a Config.
	const { universe: _universe, ...config } = parsed as Config;
	return config;
}

function setUp({
	config = CONFIG,
	configFile = CONFIG_FILE,
	http,
	initial = {},
	refuseRead = false,
	text = JSON.stringify(config, undefined, "\t"),
}: Setup) {
	const files = new Map<string, string | Uint8Array>([[configFile, text]]);
	const writes: Array<string> = [];
	const store = fakeStateStore({
		initial,
		...(refuseRead
			? { refuseRead: { staging: { file: "staging", kind: "stateError", reason: "denied" } } }
			: {}),
	});
	return {
		files,
		options: {
			config,
			configFile,
			environment: "production",
			getEnv: environmentFrom({}),
			linkRegistries: { staging: unlistedRegistry() },
			readFile: async () => new Uint8Array(),
			readTextFile: async (path: string) => String(files.get(path)),
			registry: registryFor(http),
			statePort: store.port,
			writeFile: async (path: string, contents: string | Uint8Array) => {
				writes.push(path);
				files.set(path, contents);
			},
		},
		store,
		writes,
	};
}

describe(importItemsAsync, () => {
	it("should write a root entry, an importId line and the stored icon without writing State", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const { files, options, store } = setUp({ http });
		const result = await importItemsAsync({
			...options,
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		assert(result.success, JSON.stringify(result));

		expect(files.get("assets/passes/vip-pass.png")).toStrictEqual(ICON);
		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			environments: { production: { passes: { "vip-pass": { importId: PASS_ID } } } },
			passes: {
				"vip-pass": {
					name: "VIP Pass",
					description: "Grants VIP perks.",
					icon: { "en-us": "assets/passes/vip-pass.png" },
					price: 500,
				},
			},
		});
		expect(result.data).toMatchObject({
			configWritten: true,
			iconFallbacks: [],
			redacted: [],
			refused: [],
			unreadStates: [],
		});
		expect(store.writes).toBeEmpty();
		expect(http.requests.every(({ request }) => request.method === "GET")).toBeTrue();
	});

	it("should name the imports the next deploy of a redacted Environment replaces", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const config = { ...CONFIG, environments: { production: { redacted: true }, staging: {} } };
		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const { options } = setUp({ config, http });
		const result = await importItemsAsync({
			...options,
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.redacted).toStrictEqual(["gamePass:vip-pass"]);
	});

	it("should make the next deploy record the import without writing to Roblox", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const { files, options } = setUp({ http });
		const imported = await importItemsAsync({
			...options,
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		assert(imported.success, JSON.stringify(imported));

		const replay = createFakeHttpClient()
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse(LOCATION)
			.mockResponse(passList());
		const store = fakeStateStore();
		const deployed = await deploy({
			config: withoutUniverse(String(files.get(CONFIG_FILE))),
			environment: "production",
			readFile: async () => ICON,
			registry: registryFor(replay),
			statePort: store.port,
		});
		assert(deployed.success, JSON.stringify(deployed));

		expect(store.states.get("production")!.resources.map(({ key }) => key)).toStrictEqual([
			"vip-pass",
		]);
		expect(replay.requests.every(({ request }) => request.method === "GET")).toBeTrue();
	});

	it("should declare iconBaseline and report the item when the icon cannot be downloaded", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse(passList())
			.mockApiError({ statusCode: 403 });
		const { files, options } = setUp({ http });
		const result = await importItemsAsync({
			...options,
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		assert(result.success, JSON.stringify(result));

		expect(files.has("assets/passes/vip-pass.png")).toBeFalse();
		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			environments: {
				production: {
					passes: {
						"vip-pass": { iconBaseline: "accept-local-file", importId: PASS_ID },
					},
				},
			},
		});
		expect(result.data.iconFallbacks).toMatchObject([
			{
				key: "vip-pass",
				kind: "gamePass",
				path: "assets/passes/vip-pass.png",
				robloxId: PASS_ID,
			},
		]);
	});

	it("should return paste text and leave a Luau config unwritten", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const { files, options, writes } = setUp({
			configFile: "bedrock.config.luau",
			http,
			text: "return {}\n",
		});
		const result = await importItemsAsync({
			...options,
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		assert(result.success, JSON.stringify(result));

		expect(files.get("bedrock.config.luau")).toBe("return {}\n");
		expect(writes).toStrictEqual(["assets/passes/vip-pass.png"]);
		expect(result.data.configWritten).toBeFalse();
		expect(result.data.edits.map(({ status }) => status)).toStrictEqual(["notSafe", "notSafe"]);
	});

	it("should write the edits it can and return paste text for the rest", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const { files, options } = setUp({
			config: {
				...CONFIG,
				environments: {
					production: {
						passes: {
							"vip-pass": {
								name: "Old",
								description: "",
								icon: { "en-us": "old.png" },
								importId: "1",
								price: 1,
							},
						},
					},
					staging: {},
				},
			},
			http,
		});
		const result = await importItemsAsync({
			...options,
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.edits.map(({ status }) => status)).toStrictEqual(["written", "notSafe"]);
		expect(result.data.configWritten).toBeTrue();
		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			passes: { "vip-pass": { name: "VIP Pass" } },
		});
	});

	it.for([
		["package.json", "{}"],
		[undefined, ""],
	] as const)(
		"should return paste text for a config it cannot edit in place (%s)",
		async ([configFile, text], { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
			const { files, options } = setUp({ configFile: "package.json", http, text });
			const result = await importItemsAsync({
				...options,
				configFile,
				selections: [{ kind: "gamePass", robloxId: PASS_ID }],
			});
			assert(result.success, JSON.stringify(result));

			expect(files.get("package.json")).toBe(text);
			expect(result.data.configWritten).toBeFalse();
			expect(result.data.edits[0]).toMatchObject({ paste: { path: ["passes"] } });
		},
	);

	it("should refuse a tracked item and import a disabled badge by its id", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse(passList())
			.mockResponse({ body: badgeBody(), status: 200 })
			.mockResponse(LOCATION);
		const { files, options } = setUp({
			http,
			initial: {
				production: {
					environment: "production",
					resources: [
						gamePassCurrent({
							outputs: {
								assetId: PASS_ID,
								iconAssetIds: { "en-us": asRobloxAssetId("1") },
							},
						}),
					],
					version: 1,
				},
			},
			refuseRead: true,
		});
		const result = await importItemsAsync({
			...options,
			selections: [
				{ kind: "gamePass", robloxId: PASS_ID },
				{ kind: "badge", robloxId: BADGE_ID },
			],
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.refused).toMatchObject([{ reason: "tracked", robloxId: PASS_ID }]);
		expect(result.data.unreadStates).toStrictEqual(["staging"]);
		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			badges: { "first-win": { name: "First Win", enabled: false } },
		});
		expect(files.get("assets/badges/first-win.png")).toStrictEqual(ICON);
	});

	it("should import a developer product with its stored icon", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: validDeveloperProductBody({ productId: 11 }), status: 200 })
			.mockResponse(LOCATION);
		const { files, options } = setUp({ http });
		const result = await importItemsAsync({
			...options,
			selections: [{ kind: "developerProduct", robloxId: asRobloxAssetId("11") }],
		});
		assert(result.success, JSON.stringify(result));

		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			products: {
				"gem-pack": { name: "Gem Pack", icon: { "en-us": "assets/products/gem-pack.png" } },
			},
		});
		expect(files.get("assets/products/gem-pack.png")).toStrictEqual(ICON);
	});

	it("should refuse an item no Driver can read and ask for an icon no Driver can download", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList());
		const { files, options } = setUp({ http });
		const { readIcon: _readIcon, ...gamePass } = options.registry.gamePass;
		const result = await importItemsAsync({
			...options,
			registry: { ...options.registry, badge: trap, gamePass },
			selections: [
				{ kind: "badge", robloxId: BADGE_ID },
				{ kind: "gamePass", robloxId: PASS_ID },
			],
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.refused).toMatchObject([{ reason: "notLive", robloxId: BADGE_ID }]);
		expect(result.data.iconFallbacks).toStrictEqual([
			{
				key: "vip-pass",
				cause: undefined,
				kind: "gamePass",
				path: "assets/passes/vip-pass.png",
				robloxId: PASS_ID,
			},
		]);
		expect(files.has("assets/passes/vip-pass.png")).toBe(false);
	});

	it.for(["badge", "developerProduct"] as const)(
		"should stop when a selected %s cannot be read",
		async (kind, { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockApiError({ statusCode: 500 })
				.mockApiError({ statusCode: 500 })
				.mockApiError({ statusCode: 500 });
			const { options } = setUp({ http });

			await expect(
				importItemsAsync({ ...options, selections: [{ kind, robloxId: BADGE_ID }] }),
			).resolves.toMatchObject({
				err: { kind: "liveCheckFailed", resourceKind: kind },
				success: false,
			});
		},
	);

	it("should read State through the config backend when no State port is given", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList());
		const { options } = setUp({ http });
		const { statePort: _statePort, ...rest } = options;
		const result = await importItemsAsync(rest);
		assert(result.success, JSON.stringify(result));

		expect(result.data.configWritten).toBeFalse();
		expect(result.data.unreadStates).toStrictEqual(["production", "staging"]);
	});

	it("should write the same config for a chosen item as for a selected one", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const selected = setUp({
			http: createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION),
		});
		const chosen = setUp({
			http: createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION),
		});
		const seen: Array<unknown> = [];
		await importItemsAsync({
			...selected.options,
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		const result = await importItemsAsync({
			...chosen.options,
			choose: async (items) => {
				seen.push(...items);
				return {
					data: { selections: [{ kind: "gamePass", robloxId: PASS_ID }], untrack: [] },
					success: true,
				};
			},
		});
		assert(result.success, JSON.stringify(result));

		expect(seen).toMatchObject([{ key: "vip-pass", robloxId: PASS_ID, trackedBy: undefined }]);
		expect(chosen.files).toStrictEqual(selected.files);
	});

	it("should write a chosen Key and put the icon under it", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const { files, options } = setUp({ http });
		const result = await importItemsAsync({
			...options,
			choose: async () => {
				return {
					data: {
						selections: [{ key: "vip", kind: "gamePass", robloxId: PASS_ID }],
						untrack: [],
					},
					success: true,
				};
			},
		});
		assert(result.success, JSON.stringify(result));

		expect(files.get("assets/passes/vip.png")).toStrictEqual(ICON);
		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			environments: { production: { passes: { vip: { importId: PASS_ID } } } },
			passes: { vip: { icon: { "en-us": "assets/passes/vip.png" } } },
		});
	});

	it("should write retired untrack on the root entry of a cleared tracked item", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const config = {
			...CONFIG,
			passes: {
				"vip-pass": { name: "VIP", description: "", icon: { "en-us": "vip.png" } },
			},
		} satisfies Config;
		const { files, options, writes } = setUp({
			config,
			http: createFakeHttpClient().mockResponse(passList()),
			initial: {
				production: {
					environment: "production",
					resources: [
						gamePassCurrent({
							outputs: {
								assetId: PASS_ID,
								iconAssetIds: { "en-us": asRobloxAssetId("1") },
							},
						}),
					],
					version: 1,
				},
			},
		});
		const result = await importItemsAsync({
			...options,
			choose: async (items) => {
				return {
					data: {
						selections: [],
						untrack: items.filter(({ trackedBy }) => trackedBy === "vip-pass"),
					},
					success: true,
				};
			},
		});
		assert(result.success, JSON.stringify(result));

		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			passes: { "vip-pass": { retired: "untrack" } },
		});
		expect(writes).toStrictEqual([CONFIG_FILE]);
	});

	it("should write nothing when the choice is cancelled", async ({ expect }) => {
		expect.hasAssertions();

		const { options, writes } = setUp({
			http: createFakeHttpClient().mockResponse(passList()),
		});
		const result = await importItemsAsync({
			...options,
			choose: async () => ({ err: { kind: "cancelled" }, success: false }),
		});

		expect(result).toStrictEqual({ err: { kind: "cancelled" }, success: false });
		expect(writes).toBeEmpty();
	});

	it("should stop on an unknown Environment, a missing credential or a failed list", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { options } = setUp({ http: createFakeHttpClient() });
		const { readFile: _readFile, registry: _registry, ...withoutRegistry } = options;
		const failing = setUp({
			http: createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockApiError({ statusCode: 500 })
				.mockApiError({ statusCode: 500 })
				.mockApiError({ statusCode: 500 }),
		});
		const selections = [{ kind: "gamePass", robloxId: PASS_ID }] as const;

		await expect(
			importItemsAsync({ ...options, environment: "nope", selections }),
		).resolves.toMatchObject({ err: { kind: "unknownEnvironment" }, success: false });
		await expect(importItemsAsync({ ...withoutRegistry, selections })).resolves.toMatchObject({
			err: { kind: "missingCredential" },
			success: false,
		});
		await expect(importItemsAsync({ ...failing.options, selections })).resolves.toMatchObject({
			err: { kind: "liveCheckFailed", resourceKind: "gamePass" },
			success: false,
		});
	});

	it("should link each selection to its same-name item in another Environment with link auto", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const staging = createFakeHttpClient().mockResponse(
			otherPassList("[STAGING] VIP Pass", 1_111),
		);
		const { files, options } = setUp({
			config: { ...CONFIG, environments: { production: {}, staging: { label: "staging" } } },
			http,
		});
		const result = await importItemsAsync({
			...options,
			link: "auto",
			linkRegistries: { staging: registryFor(staging) },
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		assert(result.success, JSON.stringify(result));

		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			environments: {
				production: { passes: { "vip-pass": { importId: PASS_ID } } },
				staging: { passes: { "vip-pass": { importId: "1111" } } },
			},
		});
		expect(result.data.links).toMatchObject([
			{
				candidates: [
					{
						differences: [
							{
								config: "assets/passes/vip-pass.png",
								field: "icon",
								live: "1122334456",
							},
							{ config: "VIP Pass", field: "name", live: "[STAGING] VIP Pass" },
							{ config: 500, field: "price", live: 400 },
						],
					},
				],
				environment: "staging",
				linked: "1111",
				suggested: "1111",
			},
		]);
	});

	it("should leave a selection unlinked with link auto when no item has its name", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const staging = createFakeHttpClient().mockResponse(otherPassList("Renamed", 3_333));
		const { files, options } = setUp({ http });
		const result = await importItemsAsync({
			...options,
			link: "auto",
			linkRegistries: { staging: registryFor(staging) },
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		assert(result.success, JSON.stringify(result));

		expect(
			withoutUniverse(String(files.get(CONFIG_FILE))).environments["staging"],
		).toStrictEqual({});
		expect(result.data.links).toMatchObject([{ linked: undefined, suggested: undefined }]);
	});

	it("should read no other Environment and link nothing by default", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const { files, options } = setUp({ http });
		const result = await importItemsAsync({
			...options,
			linkRegistries: undefined,
			selections: [{ kind: "gamePass", robloxId: PASS_ID }],
		});
		assert(result.success, JSON.stringify(result));

		expect(
			withoutUniverse(String(files.get(CONFIG_FILE))).environments["staging"],
		).toStrictEqual({});
		expect(result.data.links).toBeEmpty();
	});

	it("should let the picker plan links and write the chosen one", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse(passList()).mockResponse(LOCATION);
		const staging = createFakeHttpClient().mockResponse(otherPassList("Renamed", 2_222));
		const { files, options } = setUp({ http });
		const planned: Array<unknown> = [];
		const result = await importItemsAsync({
			...options,
			choose: async (_items, planLinks) => {
				const selection = { key: "vip", kind: "gamePass", robloxId: PASS_ID } as const;
				planned.push(...planLinks([selection]));
				return {
					data: {
						selections: [{ ...selection, links: { staging: asRobloxAssetId("2222") } }],
						untrack: [],
					},
					success: true,
				};
			},
			linkRegistries: { staging: registryFor(staging) },
		});
		assert(result.success, JSON.stringify(result));

		expect(planned).toMatchObject([
			{
				key: "vip",
				candidates: [{ name: "Renamed", robloxId: "2222" }],
				suggested: undefined,
			},
		]);
		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			environments: { staging: { passes: { vip: { importId: "2222" } } } },
		});
	});

	it("should count a Kind with no list in another Environment as not checked", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const seen: Array<ReadonlyArray<ImportItem>> = [];
		async function choose(items: ReadonlyArray<ImportItem>) {
			seen.push(items);
			return { err: { kind: "cancelled" as const }, success: false as const };
		}

		const { list: _list, ...unlisted } = registryFor(createFakeHttpClient()).gamePass;
		const emptyList = createFakeHttpClient().mockResponse({
			// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
			body: { gamePasses: [], nextPageToken: null },
			status: 200,
		});
		await importItemsAsync({
			...setUp({ http: createFakeHttpClient().mockResponse(passList()) }).options,
			choose,
			linkRegistries: {
				staging: { ...registryFor(createFakeHttpClient()), gamePass: unlisted },
			},
		});
		await importItemsAsync({
			...setUp({ http: createFakeHttpClient().mockResponse(passList()) }).options,
			choose,
			linkRegistries: { staging: registryFor(emptyList) },
		});

		expect(seen.map((items) => items[0]!.unavailable)).toMatchObject([
			undefined,
			{ reason: "onlyOneEnvironment" },
		]);
	});

	it("should stop when another Environment cannot be read", async ({ expect }) => {
		expect.hasAssertions();

		const selections = [{ kind: "gamePass", robloxId: PASS_ID }] as const;
		const failing = createFakeHttpClient()
			.mockApiError({ statusCode: 500 })
			.mockApiError({ statusCode: 500 })
			.mockApiError({ statusCode: 500 })
			.mockApiError({ statusCode: 500 });

		await expect(
			importItemsAsync({
				...setUp({ http: createFakeHttpClient().mockResponse(passList()) }).options,
				link: "auto",
				linkRegistries: undefined,
				selections,
			}),
		).resolves.toMatchObject({ err: { kind: "missingCredential" }, success: false });
		await expect(
			importItemsAsync({
				...setUp({ http: createFakeHttpClient().mockResponse(passList()) }).options,
				link: "auto",
				linkRegistries: { staging: registryFor(failing) },
				selections,
			}),
		).resolves.toMatchObject({ err: { kind: "liveCheckFailed" }, success: false });
	});

	it("should check every listed Kind of another Environment", async ({ expect }) => {
		expect.hasAssertions();

		async function empty() {
			return { data: new Map<never, never>(), success: true as const };
		}

		function emptyPasses() {
			return registryFor(
				createFakeHttpClient().mockResponse({
					// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
					body: { gamePasses: [], nextPageToken: null },
					status: 200,
				}),
			);
		}

		const staging = emptyPasses();
		const seen: Array<ImportItem> = [];
		const options = {
			...setUp({ http: createFakeHttpClient() }).options,
			choose: async (items: ReadonlyArray<ImportItem>) => {
				seen.push(...items);
				return { err: { kind: "cancelled" as const }, success: false as const };
			},
		};
		const source = registryFor(createFakeHttpClient().mockResponse(passList()));
		const registry = {
			...source,
			badge: {
				...source.badge,
				list: async () => {
					return {
						data: new Map([
							[
								BADGE_ID,
								{
									name: "First Win",
									description: "Win.",
									enabled: true,
									kind: "badge" as const,
									outputs: { iconImageId: asRobloxAssetId("1") },
								},
							],
						]),
						success: true as const,
					};
				},
			},
			developerProduct: {
				...source.developerProduct,
				list: async () => {
					return {
						data: new Map([
							[
								asRobloxAssetId("77"),
								{
									name: "Gems",
									description: "Gems.",
									kind: "developerProduct" as const,
									outputs: {},
									price: 5,
								},
							],
						]),
						success: true as const,
					};
				},
			},
		};
		await importItemsAsync({
			...options,
			linkRegistries: {
				staging: {
					...staging,
					badge: { ...staging.badge, list: empty },
					developerProduct: { ...staging.developerProduct, list: empty },
				},
			},
			registry,
		});
		await importItemsAsync({
			...options,
			linkRegistries: { staging: emptyPasses() },
			registry: {
				...registry,
				gamePass: registryFor(createFakeHttpClient().mockResponse(passList())).gamePass,
			},
		});

		expect(seen.map(({ kind, unavailable }) => ({ kind, unavailable }))).toMatchObject([
			{ kind: "gamePass", unavailable: { reason: "onlyOneEnvironment" } },
			{ kind: "developerProduct", unavailable: { reason: "onlyOneEnvironment" } },
			{ kind: "badge", unavailable: { reason: "onlyOneEnvironment" } },
			{ kind: "gamePass", unavailable: { reason: "onlyOneEnvironment" } },
			{ kind: "developerProduct", unavailable: undefined },
			{ kind: "badge", unavailable: undefined },
		]);
	});
});
