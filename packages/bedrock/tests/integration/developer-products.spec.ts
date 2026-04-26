import {
	applyOps,
	asRobloxAssetId,
	buildDesired,
	createDeveloperProductDriver,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	type ResourceDriver,
	selectEnvironment,
} from "@bedrock/core";
import { DeveloperProductsClient } from "@bedrock/ocale/developer-products";
import { createFakeHttpClient, validDeveloperProductBody } from "@bedrock/ocale/testing";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PRODUCTS_FIXTURE_DIR = join(FIXTURES_ROOT, "developer-products");
const UNIVERSE_ID = asRobloxAssetId("1234567890");

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

const UNIVERSE_TRAP: ResourceDriver<"universe"> = {
	create() {
		throw new Error("UniverseDriver.create must not run for developer-product fixtures");
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
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_TRAP,
		};

		const ops = diff(desiredResult.data, []);

		// Universe declared but with no managed fields produces a noop
		// alongside the developer-product create.
		expect(ops.map((op) => op.type).filter((type) => type !== "noop")).toStrictEqual([
			"create",
		]);

		const applyResult = await applyOps(ops, registry);

		assert(applyResult.success);

		expect(applyResult.data).toHaveLength(1);
		expect(httpClient.requests).toHaveLength(1);

		const [first] = httpClient.requests;
		assert(first);

		expect(first.request.url).toBe(
			`/developer-products/v2/universes/${UNIVERSE_ID}/developer-products`,
		);

		const created = applyResult.data[0]!;
		assert(created.kind === "developerProduct");

		expect(created.outputs.productId).toBe("8172635495");
	});
});
