import {
	applyOps,
	asRobloxAssetId,
	buildDesired,
	createPlaceDriver,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	type ResourceDriver,
	selectEnvironment,
} from "@bedrock-rbx/core";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import { createFakeHttpClient, validPlaceBody } from "@bedrock-rbx/ocale/testing";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PLACES_FIXTURE_DIR = join(FIXTURES_ROOT, "places");
const PLACES_METADATA_FIXTURE_DIR = join(FIXTURES_ROOT, "places-metadata");
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const PLACE_ID = asRobloxAssetId("4711");
const RBXL_BYTES = new Uint8Array([
	0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x21, 0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const DEVELOPER_PRODUCT_TRAP: ResourceDriver<"developerProduct"> = {
	create() {
		throw new Error("DeveloperProductDriver.create must not run for place fixtures");
	},
};

const GAME_PASS_TRAP: ResourceDriver<"gamePass"> = {
	create() {
		throw new Error("GamePassDriver.create must not run for place fixtures");
	},
};

const UNIVERSE_TRAP: ResourceDriver<"universe"> = {
	create() {
		throw new Error("UniverseDriver.create must not run for place fixtures");
	},
};

async function readPlaceFile(): Promise<Uint8Array> {
	return RBXL_BYTES;
}

describe("places pipeline end-to-end", () => {
	it("should publish a declared place through the full loadConfig to applyOps pipeline", async () => {
		expect.assertions(4);

		const loaded = await loadConfig({ cwd: PLACES_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readPlaceFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { versionNumber: 1 },
			status: 200,
		});

		const registry: DriverRegistry = {
			developerProduct: DEVELOPER_PRODUCT_TRAP,
			gamePass: GAME_PASS_TRAP,
			place: createPlaceDriver({
				client: new PlacesClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile: readPlaceFile,
				universeId: UNIVERSE_ID,
			}),
			universe: UNIVERSE_TRAP,
		};

		const ops = diff(desiredResult.data, []);

		expect(ops.map((op) => op.type)).toStrictEqual(["create"]);

		const applyResult = await applyOps(ops, registry);

		expect(applyResult.success).toBeTrue();
		expect(httpClient.requests).toHaveLength(1);

		const [first] = httpClient.requests;
		assert(first);

		expect(first.request.url).toBe(
			`/universes/v1/${UNIVERSE_ID}/places/${PLACE_ID}/versions?versionType=Published`,
		);
	});

	it("should issue a metadata PATCH after publish when displayName, description, and serverSize are declared", async () => {
		expect.assertions(4);

		const loaded = await loadConfig({ cwd: PLACES_METADATA_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readPlaceFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: { versionNumber: 1 }, status: 200 })
			.mockResponse({
				body: validPlaceBody({
					description: "The lobby place.",
					displayName: "Start Place",
					serverSize: 50,
				}),
				status: 200,
			});

		const registry: DriverRegistry = {
			developerProduct: DEVELOPER_PRODUCT_TRAP,
			gamePass: GAME_PASS_TRAP,
			place: createPlaceDriver({
				client: new PlacesClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile: readPlaceFile,
				universeId: UNIVERSE_ID,
			}),
			universe: UNIVERSE_TRAP,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);

		expect(applyResult.success).toBeTrue();
		expect(httpClient.requests).toHaveLength(2);

		const [, second] = httpClient.requests;
		assert(second);

		expect(second.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}/places/${PLACE_ID}?updateMask=displayName,description,serverSize`,
		);
		expect(second.request.body).toStrictEqual({
			description: "The lobby place.",
			displayName: "Start Place",
			serverSize: 50,
		});
	});
});
