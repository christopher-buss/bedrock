import {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	type BedrockState,
	buildDesired,
	createClackProgressAdapter,
	createGamePassDriver,
	deploy,
	diff,
	flattenConfig,
	loadConfig,
	type ProgressEvent,
	type ResourceDriver,
	type RetiredEntry,
	selectEnvironment,
} from "@bedrock-rbx/core";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { createFakeHttpClient } from "@bedrock-rbx/ocale/testing";
import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it, type TestContext } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";

const CURRENT_PASS = {
	key: asResourceKey("vip"),
	name: "VIP Pass",
	description: "Perks",
	icon: { "en-us": "missing.png" },
	iconFileHashes: { "en-us": asSha256Hex("a".repeat(64)) },
	kind: "gamePass" as const,
	outputs: { assetId: asRobloxAssetId("123"), iconAssetIds: { "en-us": asRobloxAssetId("456") } },
	price: 500,
};

async function loadJsonAsync(
	config: object,
	onTestFinished: TestContext["onTestFinished"],
): ReturnType<typeof loadConfig> {
	const cwd = await mkdtemp(join(tmpdir(), "bedrock-untrack-"));
	onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
	const json = JSON.stringify(config);
	assert(json !== undefined);
	await writeFile(join(cwd, "bedrock.config.json"), json);
	return loadConfig({ cwd });
}

function guardedMarker(): RetiredEntry {
	const liveFields = new Set([
		"description",
		"displayName",
		"filePath",
		"icon",
		"name",
		"placeId",
		"price",
		"redacted",
		"serverSize",
	]);
	return new Proxy({ retired: "untrack" } as const, {
		get(target, property) {
			if (typeof property === "string" && liveFields.has(property)) {
				throw new Error(`Cannot inspect a retired resource's ${property}`);
			}

			return Reflect.get(target, property);
		},
	});
}

const MARKERS = {
	environments: { production: { redacted: true }, staging: { label: "Stage" } },
	passes: { vip: { retired: "untrack" } },
	places: { lobby: { retired: "untrack" } },
	products: { gems: { retired: "untrack" } },
};
const MARKER_JSON = JSON.stringify(MARKERS);
const FORMAT_SOURCES = {
	js: `export default ${MARKER_JSON};`,
	json: MARKER_JSON,
	luau: 'return { environments = { production = { redacted = true }, staging = { label = "Stage" } }, passes = { vip = { retired = "untrack" } }, products = { gems = { retired = "untrack" } }, places = { lobby = { retired = "untrack" } } }',
	ts: `export default ${MARKER_JSON};`,
	yaml: "environments:\n  production:\n    redacted: true\n  staging:\n    label: Stage\npasses:\n  vip:\n    retired: untrack\nproducts:\n  gems:\n    retired: untrack\nplaces:\n  lobby:\n    retired: untrack\n",
};
const FORMATS = HAS_LUTE
	? (["json", "js", "ts", "yaml", "luau"] as const)
	: (["json", "js", "ts", "yaml"] as const);

describe("untrack config-to-state pipeline", () => {
	it("should plan an untrack carrying current state without reading a retired pass icon", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		const loaded = await loadJsonAsync(
			{
				environments: { production: { redacted: true } },
				passes: { vip: { retired: "untrack" } },
				places: { lobby: { retired: "untrack" } },
				products: { gems: { retired: "untrack" } },
			},
			onTestFinished,
		);

		expect(loaded).toMatchObject({ success: true });

		assert(loaded.success);
		const selected = selectEnvironment(loaded.data, "production");
		assert(selected.success);

		expect(selected.data.passes).toStrictEqual({ vip: { retired: "untrack" } });

		const desired = await buildDesired({
			async readFile() {
				throw new Error("Retired resources must not read files");
			},
			resources: flattenConfig(selected.data),
		});
		assert(desired.success);

		expect(diff(desired.data, [CURRENT_PASS])).toStrictEqual([
			{ key: asResourceKey("gems"), kind: "developerProduct", type: "noop" },
			{ key: asResourceKey("vip"), current: CURRENT_PASS, type: "untrack" },
			{ key: asResourceKey("lobby"), kind: "place", type: "noop" },
		]);
	});

	it("should persist an explicit untrack without driver requests and report its progress", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient();
		const events: Array<ProgressEvent> = [];
		const clack = fakeClackPort();
		const progress = createClackProgressAdapter({ clack });
		const writes: Array<BedrockState> = [];
		const trap: ResourceDriver<"developerProduct"> &
			ResourceDriver<"place"> &
			ResourceDriver<"universe"> = {
			async create() {
				throw new Error("Untrack must not dispatch to a driver");
			},
		};
		const result = await deploy({
			config: { environments: { production: {} }, passes: { vip: { retired: "untrack" } } },
			environment: "production",
			progress: {
				emit(event) {
					events.push(event);
					progress.emit(event);
				},
			},
			async readFile() {
				throw new Error("Untrack must not read files");
			},
			registry: {
				developerProduct: trap,
				gamePass: createGamePassDriver({
					client: new GamePassesClient({
						credential: { apiKey: "test", kind: "apiKey" },
						httpClient,
					}),
					async readFile() {
						throw new Error("Untrack must not read icons");
					},
					universeId: asRobloxAssetId("1"),
				}),
				place: trap,
				universe: trap,
			},
			statePort: {
				async read() {
					return {
						data: {
							state: {
								environment: "production",
								resources: [CURRENT_PASS],
								version: 1,
							},
						},
						success: true,
					};
				},
				async write(state) {
					writes.push(state);
					return { data: undefined, success: true };
				},
			},
		});

		expect(result).toStrictEqual({
			data: { environment: "production", resources: [], version: 1 },
			success: true,
		});
		expect(writes).toStrictEqual([{ environment: "production", resources: [], version: 1 }]);
		expect(httpClient.requests).toStrictEqual([]);
		expect(clack.logSuccess).toHaveBeenCalledWith("gamePass.vip untracked");
		expect(events).toStrictEqual(
			expect.arrayContaining([
				{
					key: "vip",
					environment: "production",
					kind: "resourceOpStarted",
					opType: "untrack",
					resourceKind: "gamePass",
				},
				{
					key: "vip",
					environment: "production",
					kind: "resourceOpSucceeded",
					opType: "untrack",
					resourceKind: "gamePass",
				},
				expect.objectContaining({
					created: 0,
					failed: 0,
					kind: "applySummary",
					noop: 0,
					untracked: 1,
					updated: 0,
				}),
			]),
		);
	});

	it.for([
		{ environments: { production: {} }, universe: { retired: "untrack" } },
		{ environments: { production: { universe: { retired: "untrack" } } } },
	])(
		"should clearly refuse universe markers before requiring a universe ID",
		async (config, { expect, onTestFinished }) => {
			expect.hasAssertions();

			const loaded = await loadJsonAsync(config, onTestFinished);

			expect(loaded.success).toBeFalse();

			assert(!loaded.success);

			expect(JSON.stringify(loaded.err)).toContain(
				"Universe removal is not available at this time.",
			);
			expect(JSON.stringify(loaded.err)).not.toContain("universeId");
		},
	);

	it("should resolve markers without inspecting live fields under overlays, redaction, or name prefixes", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const marker = guardedMarker();
		const selected = selectEnvironment(
			{
				environments: {
					production: {
						label: "Dev",
						passes: { vip: marker },
						places: { lobby: marker },
						products: { gems: marker },
						redacted: true,
					},
				},
				passes: { vip: marker },
				places: { lobby: marker },
				products: { gems: marker },
			},
			"production",
		);
		assert(selected.success);
		const desired = await buildDesired({
			async readFile() {
				throw new Error("No live files");
			},
			resources: flattenConfig(selected.data),
		});
		assert(desired.success);

		expect(diff(desired.data, [])).toStrictEqual([
			{ key: "gems", kind: "developerProduct", type: "noop" },
			{ key: "vip", kind: "gamePass", type: "noop" },
			{ key: "lobby", kind: "place", type: "noop" },
		]);
	});

	it.for(FORMATS)(
		"should accept root markers in %s in every environment",
		async (format, { expect, onTestFinished }) => {
			expect.assertions(2);

			const cwd = await mkdtemp(join(tmpdir(), "bedrock-untrack-format-"));
			onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
			await writeFile(join(cwd, `bedrock.config.${format}`), FORMAT_SOURCES[format]);
			const loaded = await loadConfig({ cwd });
			assert(loaded.success);
			const results = await Promise.all(
				["production", "staging"].map(async (environment) => {
					const selected = selectEnvironment(loaded.data, environment);
					assert(selected.success);
					const desired = await buildDesired({
						async readFile() {
							throw new Error("No files for markers");
						},
						resources: flattenConfig(selected.data),
					});
					assert(desired.success);
					return diff(desired.data, [CURRENT_PASS]);
				}),
			);

			expect(results[0]).toStrictEqual([
				{ key: "gems", kind: "developerProduct", type: "noop" },
				{ key: "vip", current: CURRENT_PASS, type: "untrack" },
				{ key: "lobby", kind: "place", type: "noop" },
			]);
			expect(results[1]).toStrictEqual(results[0]);
		},
	);

	it("should let an environment marker replace every live field while other environments keep managing the entry", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(4);

		const loaded = await loadJsonAsync(
			{
				environments: {
					production: {
						passes: { vip: { retired: "untrack" } },
						places: { lobby: { retired: "untrack" } },
						products: { gems: { retired: "untrack" } },
						redacted: true,
					},
					staging: { places: { lobby: { placeId: "789" } } },
				},
				passes: {
					vip: { name: "VIP", description: "Perks", icon: { "en-us": "missing.png" } },
				},
				places: { lobby: { displayName: "Lobby", filePath: "missing.rbxl" } },
				products: {
					gems: { name: "Gems", description: "Coins", icon: { "en-us": "product.png" } },
				},
			},
			onTestFinished,
		);
		assert(loaded.success);
		const production = selectEnvironment(loaded.data, "production");
		const staging = selectEnvironment(loaded.data, "staging");
		assert(production.success && staging.success);

		expect({
			passes: production.data.passes,
			places: production.data.places,
			products: production.data.products,
		}).toStrictEqual({
			passes: { vip: { retired: "untrack" } },
			places: { lobby: { retired: "untrack" } },
			products: { gems: { retired: "untrack" } },
		});

		const markers = await buildDesired({
			async readFile() {
				throw new Error("Retired live files must not be read");
			},
			resources: flattenConfig(production.data),
		});
		assert(markers.success);
		const reads: Array<string> = [];
		const live = await buildDesired({
			async readFile(path) {
				reads.push(path);
				return new Uint8Array([1]);
			},
			resources: flattenConfig(staging.data),
		});
		assert(live.success);

		expect(diff(markers.data, [CURRENT_PASS]).map((op) => op.type)).toStrictEqual([
			"noop",
			"untrack",
			"noop",
		]);
		expect(diff(live.data, []).map((op) => op.type)).toStrictEqual([
			"create",
			"create",
			"create",
		]);
		expect(reads).toStrictEqual(["product.png", "missing.png", "missing.rbxl"]);
	});

	it("should keep a root marker effective when an environment still carries old live overlay fields", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(2);

		const loaded = await loadJsonAsync(
			{
				...MARKERS,
				environments: {
					production: {
						passes: { vip: { name: "Old" } },
						places: { lobby: { placeId: "123" } },
						products: { gems: { description: "Old" } },
					},
				},
			},
			onTestFinished,
		);
		assert(loaded.success);
		const selected = selectEnvironment(loaded.data, "production");
		assert(selected.success);

		expect({
			passes: selected.data.passes,
			places: selected.data.places,
			products: selected.data.products,
		}).toStrictEqual({
			passes: { vip: { retired: "untrack" } },
			places: { lobby: { retired: "untrack" } },
			products: { gems: { retired: "untrack" } },
		});

		const desired = await buildDesired({
			async readFile() {
				throw new Error("No retired files");
			},
			resources: flattenConfig(selected.data),
		});
		assert(desired.success);

		expect(diff(desired.data, []).map((op) => op.type)).toStrictEqual(["noop", "noop", "noop"]);
	});

	it.for(["passes", "products", "places"] as const)(
		"should reject mixed markers and unsupported retirement values in %s",
		async (collection, { expect, onTestFinished }) => {
			expect.assertions(5);

			const root = await loadJsonAsync(
				{
					[collection]: { old: { description: "Must not be read", retired: "untrack" } },
					environments: { production: {} },
				},
				onTestFinished,
			);
			const overlay = await loadJsonAsync(
				{
					environments: {
						production: {
							[collection]: { old: { retired: "untrack", unknown: "extra field" } },
						},
					},
				},
				onTestFinished,
			);
			const unsupported = await loadJsonAsync(
				{ [collection]: { old: { retired: true } }, environments: { production: {} } },
				onTestFinished,
			);
			assert(!root.success && root.err.kind === "validationFailed");
			assert(!overlay.success && overlay.err.kind === "validationFailed");

			expect(root.err.issues.map((issue) => issue.path)).toStrictEqual([
				[collection, "old", "description"],
			]);
			expect(overlay.err.issues.map((issue) => issue.path)).toStrictEqual([
				["environments", "production", collection, "old", "unknown"],
			]);
			expect(root.err.issues[0]!.message).toContain("must be removed");
			expect(overlay.err.issues[0]!.message).toContain("must be removed");
			expect(unsupported).toMatchObject({
				err: { kind: "validationFailed" },
				success: false,
			});
		},
	);
});
