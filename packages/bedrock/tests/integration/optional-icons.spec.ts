import {
	asRobloxAssetId,
	asSha256Hex,
	type Config,
	createBadgeDriver,
	createDeveloperProductDriver,
	createGamePassDriver,
	deploy,
	type DriverRegistry,
	type ResourceCurrentState,
} from "@bedrock-rbx/core";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { REDACTED_ICON_BYTES } from "#src/core/redacted-icon";
import { badgeCurrent, developerProductCurrent, gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore, type FakeStateStore } from "#tests/helpers/state-store";
import { fakeUniverses } from "#tests/helpers/universe-owner";

const UNIVERSE_ID = asRobloxAssetId("1234567890");

const trap = {
	async create(): Promise<never> {
		throw new Error("Unexpected create");
	},
	async retire(): Promise<never> {
		throw new Error("Unexpected retire");
	},
};

async function refuseReadAsync(path: string): Promise<Uint8Array> {
	throw new Error(`Unexpected read of ${path}`);
}

function registry(httpClient: FakeHttpClient): DriverRegistry {
	return {
		badge: createBadgeDriver({
			client: new BadgesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: refuseReadAsync,
			universeId: UNIVERSE_ID,
			universes: fakeUniverses(),
		}),
		developerProduct: createDeveloperProductDriver({
			client: new DeveloperProductsClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: refuseReadAsync,
			universeId: UNIVERSE_ID,
		}),
		gamePass: createGamePassDriver({
			client: new GamePassesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: refuseReadAsync,
			universeId: UNIVERSE_ID,
		}),
		place: trap,
		universe: trap,
	};
}

async function deployAsync({
	config,
	httpClient,
	store,
}: {
	readonly config: Config;
	readonly httpClient: FakeHttpClient;
	readonly store: FakeStateStore;
}): Promise<ReadonlyArray<ResourceCurrentState>> {
	const result = await deploy({
		config,
		environment: "production",
		live: false,
		readFile: refuseReadAsync,
		registry: registry(httpClient),
		statePort: store.port,
	});
	assert(result.success);

	const state = store.states.get("production");
	assert(state !== undefined);
	return state.resources;
}

function formBodies(httpClient: FakeHttpClient): ReadonlyArray<FormData> {
	return httpClient.requests.flatMap(({ request }) => {
		return request.body instanceof FormData ? [request.body] : [];
	});
}

function storeWith(resource: ResourceCurrentState): FakeStateStore {
	return fakeStateStore({
		initial: { production: { environment: "production", resources: [resource], version: 1 } },
	});
}

describe("badges, game passes and developer products without an icon", () => {
	it("should create a badge with no icon file and record the icon id Roblox returns", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: 5, status: 200 })
			.mockResponse({
				body: validBadgeBody({ id: 2_468_013_579, iconImageId: 1_357_924_680 }),
				status: 200,
			});
		const resources = await deployAsync({
			config: {
				badges: { "first-win": { name: "First Win", description: "Win a round." } },
				environments: { production: {} },
			},
			httpClient,
			store: fakeStateStore(),
		});

		expect(formBodies(httpClient).some((body) => body.has("files"))).toBeFalse();
		expect(resources).toMatchObject([
			{
				kind: "badge",
				outputs: {
					badgeId: asRobloxAssetId("2468013579"),
					iconImageId: asRobloxAssetId("1357924680"),
				},
			},
		]);
		expect(resources[0]).not.toContainKey("icon");
	});

	it("should create a game pass with no image file and record the icon id Roblox returns", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient().mockResponse({
			body: validGamePassBody({ gamePassId: 9_876_543_210, iconAssetId: 1_122_334_455 }),
			status: 200,
		});
		const resources = await deployAsync({
			config: {
				environments: { production: {} },
				passes: { "vip-pass": { name: "VIP Pass", description: "Grants VIP perks." } },
			},
			httpClient,
			store: fakeStateStore(),
		});

		expect(formBodies(httpClient).some((body) => body.has("imageFile"))).toBeFalse();
		expect(resources).toMatchObject([
			{
				kind: "gamePass",
				outputs: {
					assetId: asRobloxAssetId("9876543210"),
					iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
				},
			},
		]);
		expect(resources[0]).not.toContainKey("icon");
	});

	it("should deploy a badge whose icon left the config without touching its live icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = badgeCurrent();
		const httpClient = createFakeHttpClient().mockResponse({ status: 200 });
		const resources = await deployAsync({
			config: {
				badges: {
					"first-win": { name: current.name, description: current.description },
				},
				environments: { production: {} },
			},
			httpClient,
			store: storeWith(current),
		});

		expect(httpClient.requests).toHaveLength(1);
		expect(resources).toMatchObject([{ kind: "badge", outputs: current.outputs }]);
		expect(resources[0]).not.toContainKey("iconFileHashes");
	});

	it("should deploy a game pass whose icon left the config without touching its live icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = gamePassCurrent();
		const httpClient = createFakeHttpClient().mockResponse({ status: 204 });
		const resources = await deployAsync({
			config: {
				environments: { production: {} },
				passes: {
					"vip-pass": {
						name: current.name,
						description: current.description,
						price: 500,
					},
				},
			},
			httpClient,
			store: storeWith(current),
		});

		expect(httpClient.requests).toHaveLength(1);
		expect(formBodies(httpClient)[0]!.has("imageFile")).toBeFalse();
		expect(resources).toMatchObject([{ kind: "gamePass", outputs: current.outputs }]);
		expect(resources[0]).not.toContainKey("iconFileHashes");
	});

	it("should deploy a developer product whose icon left the config without touching its live icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = developerProductCurrent({
			icon: { "en-us": "assets/gem-pack.png" },
			iconFileHashes: { "en-us": asSha256Hex("a".repeat(64)) },
			outputs: {
				iconImageAssetId: asRobloxAssetId("5566778899"),
				productId: asRobloxAssetId("8172635495"),
			},
		});
		const httpClient = createFakeHttpClient().mockResponse({ status: 204 });
		const resources = await deployAsync({
			config: {
				environments: { production: {} },
				products: {
					"gem-pack": { name: current.name, description: current.description },
				},
			},
			httpClient,
			store: storeWith(current),
		});

		expect(httpClient.requests).toHaveLength(1);
		expect(formBodies(httpClient)[0]!.has("imageFile")).toBeFalse();
		expect(resources).toMatchObject([{ kind: "developerProduct", outputs: current.outputs }]);
		expect(resources[0]).not.toContainKey("icon");
		expect(resources[0]).not.toContainKey("iconFileHashes");
	});

	it("should upload the placeholder icon for a redacted badge without an icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: 5, status: 200 })
			.mockResponse({ body: validBadgeBody(), status: 200 });
		await deployAsync({
			config: {
				badges: {
					"first-win": { name: "First Win", description: "Win a round.", redacted: true },
				},
				environments: { production: {} },
			},
			httpClient,
			store: fakeStateStore(),
		});

		const files = formBodies(httpClient)[0]!.get("files");
		assert(files instanceof Blob);

		expect(new Uint8Array(await files.arrayBuffer())).toStrictEqual(
			new Uint8Array(REDACTED_ICON_BYTES),
		);
	});

	it("should upload the placeholder icon for a redacted game pass without an icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient().mockResponse({
			body: validGamePassBody(),
			status: 200,
		});
		await deployAsync({
			config: {
				environments: { production: {} },
				passes: { "vip-pass": { name: "VIP Pass", description: "Perks.", redacted: true } },
			},
			httpClient,
			store: fakeStateStore(),
		});

		const imageFile = formBodies(httpClient)[0]!.get("imageFile");
		assert(imageFile instanceof Blob);

		expect(new Uint8Array(await imageFile.arrayBuffer())).toStrictEqual(
			new Uint8Array(REDACTED_ICON_BYTES),
		);
	});
});
