import {
	applyOps,
	asResourceKey,
	asRobloxAssetId,
	buildDesired,
	createDeveloperProductDriver,
	defineConfig,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	type ResourceCurrentState,
	type ResourceDriver,
	selectEnvironment,
	UNIVERSE_SINGLETON_KEY,
} from "@bedrock/core";
import { DeveloperProductsClient } from "@bedrock/ocale/developer-products";
import { createFakeHttpClient, validDeveloperProductBody } from "@bedrock/ocale/testing";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PRODUCTS_FIXTURE_DIR = join(FIXTURES_ROOT, "developer-products");
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const ROOT_PLACE_ID = asRobloxAssetId("4711");

const GAME_PASS_TRAP: ResourceDriver<"gamePass"> = {
	create() {
		throw new Error("GamePassDriver.create must not run for developer-product fixtures");
	},
};

const PLACE_TRAP: ResourceDriver<"place"> = {
	create() {
		throw new Error("PlaceDriver.create must not run for developer-product fixtures");
	},
};

const UNIVERSE_ADOPTED: ResourceCurrentState<"universe"> = {
	key: UNIVERSE_SINGLETON_KEY,
	consoleEnabled: undefined,
	desktopEnabled: undefined,
	displayName: undefined,
	kind: "universe",
	mobileEnabled: undefined,
	outputs: { rootPlaceId: ROOT_PLACE_ID },
	tabletEnabled: undefined,
	universeId: UNIVERSE_ID,
	voiceChatEnabled: undefined,
	vrEnabled: undefined,
};

const UNIVERSE_DRIVER: ResourceDriver<"universe"> = {
	async create() {
		return { data: UNIVERSE_ADOPTED, success: true };
	},
};

const UNIVERSE_TRAP: ResourceDriver<"universe"> = {
	create() {
		throw new Error(
			"UniverseDriver.create must not run when current state already adopts the universe",
		);
	},
};

async function readFileNever(): Promise<Uint8Array> {
	throw new Error("readFile must not run for developer-product slice 1");
}

describe("developer-products pipeline end-to-end", () => {
	it("should create a declared developer product through the full loadConfig to applyOps pipeline", async () => {
		expect.assertions(5);

		const loaded = await loadConfig({ cwd: PRODUCTS_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFileNever);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient().mockResponse({
			body: validDeveloperProductBody({
				name: "Gem Pack",
				description: "Stocks the player up with 1,000 premium gems.",
				productId: 8_172_635_495,
				universeId: 1_234_567_890,
			}),
			status: 200,
		});

		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile: readFileNever,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const ops = diff(desiredResult.data, []);

		expect(ops.map((op) => op.type)).toStrictEqual(["create", "create"]);

		const applyResult = await applyOps(ops, registry);

		assert(applyResult.success);

		expect(applyResult.data).toHaveLength(2);
		expect(httpClient.requests).toHaveLength(1);

		const [first] = httpClient.requests;
		assert(first);

		expect(first.request.url).toBe(
			`/developer-products/v2/universes/${UNIVERSE_ID}/developer-products`,
		);

		const created = applyResult.data.find((entry) => entry.kind === "developerProduct");
		assert(created !== undefined);

		expect(created.outputs.productId).toBe("8172635495");
	});

	it("should re-deploy as a noop when desired matches the persisted state", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: PRODUCTS_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFileNever);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient();
		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile: readFileNever,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_TRAP,
		};

		const persisted: ResourceCurrentState<"developerProduct"> = {
			key: asResourceKey("gem-pack"),
			name: "Gem Pack",
			description: "Stocks the player up with 1,000 premium gems.",
			isRegionalPricingEnabled: undefined,
			kind: "developerProduct",
			outputs: { productId: asRobloxAssetId("8172635495") },
			price: undefined,
			storePageEnabled: undefined,
		};

		const ops = diff(desiredResult.data, [persisted, UNIVERSE_ADOPTED]);

		expect(ops.every((op) => op.type === "noop")).toBeTrue();

		const applyResult = await applyOps(ops, registry);

		assert(applyResult.success);

		expect(httpClient.requests).toBeEmpty();
	});

	it("should PATCH once when the desired entry drifts from persisted state", async () => {
		expect.assertions(4);

		const loaded = await loadConfig({ cwd: PRODUCTS_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFileNever);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient().mockResponse({
			body: undefined,
			status: 204,
		});
		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile: readFileNever,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_TRAP,
		};

		const persistedProduct: ResourceCurrentState<"developerProduct"> = {
			key: asResourceKey("gem-pack"),
			name: "Gem Pack",
			description: "Old description before edit.",
			isRegionalPricingEnabled: undefined,
			kind: "developerProduct",
			outputs: { productId: asRobloxAssetId("8172635495") },
			price: undefined,
			storePageEnabled: undefined,
		};

		const ops = diff(desiredResult.data, [persistedProduct, UNIVERSE_ADOPTED]);

		expect(ops.map((op) => op.type).filter((type) => type !== "noop")).toStrictEqual([
			"update",
		]);

		const applyResult = await applyOps(ops, registry);

		assert(applyResult.success);

		expect(httpClient.requests).toHaveLength(1);
		expect(httpClient.requests[0]?.request.method).toBe("PATCH");

		const updated = applyResult.data[0]!;
		assert(updated.kind === "developerProduct");

		expect(updated.outputs.productId).toBe("8172635495");
	});

	it("should self-heal a failed follow-up patch on the next deploy by retrying the store-page update", async () => {
		expect.assertions(6);

		const config = defineConfig({
			environments: { production: {} },
			products: {
				"gem-pack": {
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					storePageEnabled: true,
				},
			},
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFileNever);
		assert(desiredResult.success);

		// First deploy: POST persists the product, PATCH fails. The driver
		// returns success so applyOps writes a current state whose
		// `storePageEnabled` reflects the wire-reported default (false), not
		// the desired value (true).
		const firstHttpClient = createFakeHttpClient()
			.mockResponse({
				body: validDeveloperProductBody({
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					productId: 8_172_635_495,
					storePageEnabled: false,
					universeId: 1_234_567_890,
				}),
				status: 200,
			})
			.mockApiError({ message: "patch boom", statusCode: 403 });

		const firstRegistry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient: firstHttpClient,
					sleep: async () => {},
				}),
				readFile: readFileNever,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const firstApply = await applyOps(diff(desiredResult.data, []), firstRegistry);
		assert(firstApply.success);

		const persistedProduct = firstApply.data.find((entry) => entry.kind === "developerProduct");
		assert(persistedProduct !== undefined);

		expect(persistedProduct.storePageEnabled).toBeFalse();
		expect(firstHttpClient.requests).toHaveLength(2);

		// Second deploy with the same config: diff should see the store-page
		// mismatch and dispatch an update op that re-issues the PATCH.
		const secondHttpClient = createFakeHttpClient().mockResponse({
			body: undefined,
			status: 204,
		});
		const secondRegistry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient: secondHttpClient,
					sleep: async () => {},
				}),
				readFile: readFileNever,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_TRAP,
		};

		const secondOps = diff(desiredResult.data, [persistedProduct, UNIVERSE_ADOPTED]);

		expect(secondOps.map((op) => op.type).filter((type) => type !== "noop")).toStrictEqual([
			"update",
		]);

		const secondApply = await applyOps(secondOps, secondRegistry);
		assert(secondApply.success);

		expect(secondHttpClient.requests).toHaveLength(1);

		const retried = secondHttpClient.requests[0]!;
		assert(retried.request.body instanceof FormData);

		expect(retried.request.method).toBe("PATCH");
		expect(retried.request.body.get("storePageEnabled")).toBe("true");
	});
});
