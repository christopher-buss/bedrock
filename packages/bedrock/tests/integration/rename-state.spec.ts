import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	type BedrockState,
	type Config,
	createGamePassDriver,
	deploy,
	type DriverRegistry,
	provision,
} from "#src/index";
import { developerProductCurrent, gamePassCurrent, placeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const config: Config = {
	environments: { production: {} },
	passes: {
		newer: {
			name: "VIP",
			description: "Perks",
			icon: { "en-us": "vip.png" },
			movedFrom: "old",
		},
	},
};
const initial: BedrockState = {
	environment: "production",
	resources: [
		gamePassCurrent({
			key: asResourceKey("old"),
			name: "VIP",
			description: "Perks",
			icon: { "en-us": "vip.png" },
			iconFileHashes: {
				"en-us": asSha256Hex(
					"039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
				),
			},
			price: undefined,
		}),
	],
	version: 1,
};

async function readFileAsync(): Promise<Uint8Array> {
	return new Uint8Array([1, 2, 3]);
}

const trap = {
	async create() {
		throw new Error("Unexpected operation");
	},
	async retire() {
		throw new Error("Unexpected retirement in this fixture");
	},
};
function registry(httpClient: FakeHttpClient): DriverRegistry {
	return {
		developerProduct: trap,
		gamePass: createGamePassDriver({
			client: new GamePassesClient({
				credential: { apiKey: "test", kind: "apiKey" },
				httpClient,
			}),
			readFile: readFileAsync,
			universeId: asRobloxAssetId("789"),
		}),
		place: trap,
		universe: trap,
	};
}

describe("renames persist through real drivers and fenced state", () => {
	it("should preserve a place publication debt under the same bare key when a pass is renamed", async ({
		expect,
	}) => {
		expect.assertions(4);

		const place = placeCurrent({ key: asResourceKey("old") });
		const store = fakeStateStore({
			initial: {
				production: {
					...initial,
					pendingRebuild: new Set([place.key]),
					resources: [...initial.resources, place],
				},
			},
		});
		const http = createFakeHttpClient();
		const result = await provision({
			config: {
				...config,
				environments: { production: { places: { old: { placeId: "4711" } } } },
				places: { old: { filePath: "places/start.rbxl" } },
			},
			environment: "production",
			readFile: readFileAsync,
			registry: registry(http),
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.pendingRebuild).toStrictEqual(new Set(["old"]));
		expect(store.states.get("production")!.pendingRebuild).toStrictEqual(new Set(["old"]));
		expect(result.data.resources).toStrictEqual([
			{ ...initial.resources[0], key: "newer" },
			place,
		]);
		expect(http.requests).toStrictEqual([]);
	});

	it("should persist a noop rename while applying a sibling untrack without driver requests", async ({
		expect,
	}) => {
		expect.assertions(3);

		const store = fakeStateStore({
			initial: {
				production: {
					...initial,
					pendingRebuild: new Set([asResourceKey("retired-place")]),
					realDisplay: { "place:retired-place": { displayName: "Old place" } },
					resources: [
						...initial.resources,
						placeCurrent({ key: asResourceKey("retired-place") }),
					],
				},
			},
		});
		const http = createFakeHttpClient();
		const result = await deploy({
			config: { ...config, places: { "retired-place": { retired: "untrack" } } },
			environment: "production",
			readFile: readFileAsync,
			registry: registry(http),
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.resources).toStrictEqual([{ ...initial.resources[0], key: "newer" }]);
		expect(result.data).not.toHaveProperty("pendingRebuild");
		expect(http.requests).toStrictEqual([]);
	});

	it("should leave another kind's metadata under a shared old key intact", async ({ expect }) => {
		expect.assertions(3);

		const prior: BedrockState = {
			...initial,
			pendingRebuild: new Set([asResourceKey("old")]),
			realDisplay: {
				"gamePass:old": { name: "Previous real name" },
				"place:old": { displayName: "Real place" },
			},
			resources: [...initial.resources, placeCurrent({ key: asResourceKey("old") })],
		};
		const store = fakeStateStore({ initial: { production: prior } });
		const http = createFakeHttpClient();
		const result = await deploy({
			config,
			environment: "production",
			readFile: readFileAsync,
			registry: registry(http),
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.pendingRebuild).toStrictEqual(new Set(["old"]));
		expect(result.data.realDisplay).toStrictEqual({
			"place:old": { displayName: "Real place" },
		});
		expect(result.data.resources.map(({ key, kind }) => ({ key, kind }))).toStrictEqual([
			{ key: "newer", kind: "gamePass" },
			{ key: "old", kind: "place" },
		]);
	});

	it("should validate a renamed product against its prior icon before any operation", async ({
		expect,
	}) => {
		expect.assertions(3);

		const productConfig: Config = {
			environments: { production: {} },
			products: { gems: { name: "Gems", description: "Currency", movedFrom: "old-gems" } },
		};
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [
						developerProductCurrent({
							key: asResourceKey("old-gems"),
							icon: { "en-us": "gems.png" },
							iconFileHashes: {
								"en-us": asSha256Hex(
									"039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
								),
							},
						}),
					],
					version: 1,
				},
			},
		});
		const http = createFakeHttpClient();
		const result = await deploy({
			config: productConfig,
			environment: "production",
			readFile: readFileAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: { key: "gems", kind: "iconRemovalRejected" },
				kind: "buildDesiredFailed",
			},
			success: false,
		});
		expect(http.requests).toStrictEqual([]);
		expect(store.writes).toStrictEqual([]);
	});

	it("should update a renamed pass using its original ID and prune the old state key", async ({
		expect,
	}) => {
		expect.assertions(5);

		const http = createFakeHttpClient().mockResponse({
			body: validGamePassBody(),
			status: 200,
		});
		const pass = initial.resources[0]!;
		assert(pass.kind === "gamePass");
		const store = fakeStateStore({
			initial: {
				production: {
					...initial,
					resources: [{ ...pass, name: "Previous name" }],
				},
			},
		});
		const result = await deploy({
			config,
			environment: "production",
			readFile: readFileAsync,
			registry: registry(http),
			statePort: store.port,
		});
		assert(result.success);

		expect(http.requests).toHaveLength(1);
		expect(http.requests[0]!.request.url).toContain("9876543210");
		expect(http.requests[0]!.request.method).toBe("PATCH");
		expect(result.data.resources).toStrictEqual([
			{ ...initial.resources[0], key: "newer", isManagedPricingEnabled: false },
		]);
		expect(store.writes[0]!.expected).toStrictEqual({ kind: "present", token: "production-1" });
	});

	it("should retain the complete rebound snapshot for recovery when a noop rename write conflicts", async ({
		expect,
	}) => {
		expect.assertions(4);

		const http = createFakeHttpClient();
		const store = fakeStateStore({
			initial: { production: initial },
			refuseWrite: {
				production: {
					file: "state.json",
					kind: "stateConflict",
					reason: "Version advanced",
				},
			},
		});
		const result = await deploy({
			config,
			environment: "production",
			readFile: readFileAsync,
			registry: registry(http),
			statePort: store.port,
		});
		assert(!result.success && result.err.kind === "stateWriteFailed");

		expect(result.err.unsavedState.resources).toStrictEqual([
			{ ...initial.resources[0], key: "newer" },
		]);
		expect(result.err.unrecorded).toStrictEqual([]);
		expect(store.states.get("production")).toBe(initial);
		expect(http.requests).toStrictEqual([]);
	});

	it("should fail the whole run before HTTP or state writes when both pass keys are occupied", async ({
		expect,
	}) => {
		expect.assertions(3);

		const http = createFakeHttpClient();
		const store = fakeStateStore({
			initial: {
				production: {
					...initial,
					resources: [
						...initial.resources,
						{ ...initial.resources[0]!, key: asResourceKey("newer") },
					],
				},
			},
		});
		const result = await deploy({
			config,
			environment: "production",
			readFile: readFileAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: { cause: { kind: "renameRejected" }, kind: "buildDesiredFailed" },
			success: false,
		});
		expect(http.requests).toStrictEqual([]);
		expect(store.writes).toStrictEqual([]);
	});
});
