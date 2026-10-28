import {
	applyOps,
	asRobloxAssetId,
	asSha256Hex,
	type BedrockState,
	buildDesired,
	type Config,
	createClackProgressAdapter,
	createDeveloperProductDriver,
	createGamePassDriver,
	createPlaceDriver,
	deploy,
	diff,
	type DriverRegistry,
	flattenConfig,
	type ProgressEvent,
	provision,
	publish,
	selectEnvironment,
	type StateError,
	type StatePort,
	type StateVersion,
} from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { BADGE_TRAP } from "#tests/helpers/drivers";
import { developerProductCurrent, gamePassCurrent, placeCurrent } from "#tests/helpers/resources";

const PASS = gamePassCurrent();
const PRODUCT = developerProductCurrent();
const PLACE = placeCurrent();
const ORPHAN = placeCurrent({ key: PASS.key, placeId: asRobloxAssetId("99") });
const VERSION = { kind: "present", token: '"record-817"' } as const;
const HASH = asSha256Hex("f".repeat(64));
const CONFIG: Config = {
	environments: { production: {} },
	passes: { "vip-pass": { retired: "untrack" } },
	places: { "start-place": { retired: "untrack" } },
	products: { "gem-pack": { retired: "untrack" } },
};

async function noFilesAsync(): Promise<Uint8Array> {
	throw new Error("Untrack must not read live icons or artifacts");
}

function liveRegistry(httpClient: FakeHttpClient): DriverRegistry {
	const options = {
		credential: { apiKey: "test", kind: "apiKey" } as const,
		httpClient,
		sleep: async () => {},
	};
	const deps = { readFile: noFilesAsync, universeId: asRobloxAssetId("1") };
	return {
		badge: BADGE_TRAP,
		developerProduct: createDeveloperProductDriver({
			...deps,
			client: new DeveloperProductsClient(options),
		}),
		gamePass: createGamePassDriver({ ...deps, client: new GamePassesClient(options) }),
		place: createPlaceDriver({ ...deps, client: new PlacesClient(options) }),
		universe: {
			async create() {
				throw new Error("No universe is declared");
			},
			async retire() {
				throw new Error("Unexpected retirement in this fixture");
			},
		},
	};
}

function stateHarness(
	initial: BedrockState,
	failure?: StateError,
): {
	port: StatePort;
	writes: Array<{ expected: StateVersion | undefined; state: BedrockState }>;
} {
	let current = initial;
	const writes: Array<{ expected: StateVersion | undefined; state: BedrockState }> = [];
	return {
		port: {
			async read() {
				return { data: { state: current, version: VERSION }, success: true };
			},
			async write(state, expected) {
				writes.push({ expected, state });
				if (failure !== undefined) {
					return { err: failure, success: false };
				}

				current = state;
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

describe("untrack persistence", () => {
	it.for([
		[PASS, "VIP Pass", "9876543210"],
		[PRODUCT, "Gem Pack", "8172635495"],
		[placeCurrent({ displayName: "Saved Lobby" }), "Saved Lobby", "4711"],
		[PLACE, "start-place", "4711"],
	] as const)(
		"should report the saved name and Roblox ID for an untrack operation on %j",
		async ([current, name, robloxId], { expect }) => {
			expect.hasAssertions();

			const httpClient = createFakeHttpClient();
			const { port, writes } = stateHarness({
				environment: "production",
				resources: [current],
				version: 1,
			});
			const clack = fakeClackPort();
			const progress = createClackProgressAdapter({ clack });
			const events: Array<ProgressEvent> = [];
			const result = await deploy({
				config: CONFIG,
				environment: "production",
				progress: {
					emit(event) {
						events.push(event);
						progress.emit(event);
					},
				},
				readFile: noFilesAsync,
				registry: liveRegistry(httpClient),
				statePort: port,
			});

			expect(result.success).toBeTrue();
			expect(writes[0]!.state.resources).toStrictEqual([]);
			expect(httpClient.requests).toStrictEqual([]);
			expect(events).toContainEqual({
				key: current.key,
				name,
				environment: "production",
				kind: "resourceOpSucceeded",
				opType: "untrack",
				resourceKind: current.kind,
				robloxId,
			});
			expect(clack.logSuccess).toHaveBeenCalledWith(
				`${current.kind}.${current.key} ${name} (id ${robloxId}) untracked`,
			);
		},
	);

	it("should refuse an unmarked orphan of another kind before dropping marked resources", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient();
		const { port, writes } = stateHarness({
			codegenHash: HASH,
			environment: "production",
			pendingRebuild: new Set([ORPHAN.key, PLACE.key]),
			realDisplay: {
				"gamePass:vip-pass": { name: "Real VIP" },
				"place:start-place": { displayName: "Real lobby" },
			},
			resources: [PASS, PRODUCT, PLACE, ORPHAN],
			version: 1,
		});
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: liveRegistry(httpClient),
			statePort: port,
		});

		expect(result).toMatchObject({
			err: {
				cause: { kind: "orphanRejected", orphans: [{ key: PASS.key, kind: "place" }] },
				kind: "buildDesiredFailed",
			},
			success: false,
		});
		expect(writes).toBeEmpty();
		expect(httpClient.requests).toStrictEqual([]);
	});

	it("should keep a complete unsaved snapshot when a state-only drop loses its write fence", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient();
		const cause: StateError = {
			file: "production.json",
			kind: "stateConflict",
			reason: "record changed",
		};
		const { port, writes } = stateHarness(
			{ environment: "production", resources: [PASS, PRODUCT, PLACE], version: 1 },
			cause,
		);
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: liveRegistry(httpClient),
			statePort: port,
		});

		expect(result).toStrictEqual({
			err: {
				cause,
				kind: "stateWriteFailed",
				unrecorded: [],
				unsavedState: { environment: "production", resources: [], version: 1 },
			},
			success: false,
		});
		expect(writes[0]!.expected).toStrictEqual(VERSION);
		expect(httpClient.requests).toStrictEqual([]);
	});

	it("should persist successful untrack operations when a sibling live update fails", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { message: "Rejected update" },
			status: 400,
		});
		const { port, writes } = stateHarness({
			environment: "production",
			resources: [PASS, PRODUCT],
			version: 1,
		});
		const result = await deploy({
			config: {
				...CONFIG,
				products: { "gem-pack": { name: "Updated gems", description: "New description" } },
			},
			environment: "production",
			readFile: noFilesAsync,
			registry: liveRegistry(httpClient),
			statePort: port,
		});

		expect(result).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(writes).toStrictEqual([
			{
				expected: VERSION,
				state: { environment: "production", resources: [PRODUCT], version: 1 },
			},
		]);
		expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual(["PATCH"]);
	});

	it.for([
		{ resources: [], run: provision },
		{ resources: [PASS, PRODUCT, PLACE], run: publish },
	])(
		"should route markers through the asset stage without reading old place artifacts",
		async ({ resources, run }, { expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient();
			const { port } = stateHarness({
				environment: "production",
				resources: [PASS, PRODUCT, PLACE],
				version: 1,
			});
			const result = await run({
				config: CONFIG,
				environment: "production",
				readFile: noFilesAsync,
				registry: liveRegistry(httpClient),
				statePort: port,
			});
			assert(result.success);

			expect(result.data.resources).toStrictEqual(resources);
			expect(httpClient.requests).toStrictEqual([]);
		},
	);

	it("should apply current-bearing untrack operations silently without returning live survivors", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient();
		const selected = selectEnvironment(CONFIG, "production");
		assert(selected.success);
		const desired = await buildDesired({
			readFile: noFilesAsync,
			resources: flattenConfig(selected.data),
		});
		assert(desired.success);
		const result = await applyOps(
			diff(desired.data, [PASS, PRODUCT, PLACE]),
			liveRegistry(httpClient),
		);

		expect(result).toStrictEqual({ data: [], success: true });
		expect(httpClient.requests).toStrictEqual([]);
	});

	it("should preserve markers beside live redacted resources and keep only live metadata", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient().mockResponse({
			body: validGamePassBody(),
			status: 200,
		});
		const { port, writes } = stateHarness({
			environment: "production",
			realDisplay: { "gamePass:vip-pass": { name: "Old" } },
			resources: [PASS],
			version: 1,
		});
		const result = await deploy({
			config: {
				environments: { production: {} },
				passes: {
					"fresh": {
						name: "Fresh Pass",
						description: "Real perks",
						icon: { "en-us": "missing.png" },
						redacted: true,
					},
					"vip-pass": { retired: "untrack" },
				},
			},
			environment: "production",
			readFile: noFilesAsync,
			registry: liveRegistry(httpClient),
			statePort: port,
		});
		assert(result.success);

		expect(result.data.resources.map(({ key }) => key)).toStrictEqual(["fresh"]);
		expect(writes[0]!.state.realDisplay).toStrictEqual({
			"gamePass:fresh": { name: "Fresh Pass", description: "Real perks" },
		});
		expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual(["POST"]);
	});
});
