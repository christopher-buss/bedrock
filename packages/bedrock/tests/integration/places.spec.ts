import {
	applyOps,
	asRobloxAssetId,
	buildDesired,
	createPlaceDriver,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	type PlaceDesiredState,
	type ResourceDriver,
	selectEnvironment,
} from "@bedrock-rbx/core";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import { createFakeHttpClient, validPlaceBody } from "@bedrock-rbx/ocale/testing";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it, vi } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PLACES_FIXTURE_DIR = join(FIXTURES_ROOT, "places");
const PLACES_METADATA_FIXTURE_DIR = join(FIXTURES_ROOT, "places-metadata");
const PLACES_CONFIG_ONLY_FIXTURE_DIR = join(FIXTURES_ROOT, "places-config-only");
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

async function readPlaceFileAsync(): Promise<Uint8Array> {
	return RBXL_BYTES;
}

describe("places pipeline end-to-end", () => {
	it("should publish a declared place through the full loadConfig to applyOps pipeline", async () => {
		expect.assertions(4);

		const loaded = await loadConfig({ cwd: PLACES_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired({
			readFile: readPlaceFileAsync,
			resources: flattenConfig(resolved.data),
		});
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
				readFile: readPlaceFileAsync,
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

		const desiredResult = await buildDesired({
			readFile: readPlaceFileAsync,
			resources: flattenConfig(resolved.data),
		});
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
				readFile: readPlaceFileAsync,
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

	it("should PATCH metadata and read no file for a place that declares no filePath", async () => {
		expect.assertions(5);

		const loaded = await loadConfig({ cwd: PLACES_CONFIG_ONLY_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const readFile = vi.fn<() => Promise<Uint8Array>>(readPlaceFileAsync);
		const desiredResult = await buildDesired({
			readFile,
			resources: flattenConfig(resolved.data),
		});
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient().mockResponse({
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
				readFile,
				universeId: UNIVERSE_ID,
			}),
			universe: UNIVERSE_TRAP,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);

		assert(applyResult.success);

		expect(readFile).not.toHaveBeenCalled();
		expect(httpClient.requests).toHaveLength(1);

		const [only] = httpClient.requests;
		assert(only);

		expect(only.request.method).toBe("PATCH");
		expect(only.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}/places/${PLACE_ID}?updateMask=displayName,description,serverSize`,
		);
		expect(applyResult.data[0]).toStrictEqual({
			key: "start-place",
			description: "The lobby place.",
			displayName: "Start Place",
			fileHash: undefined,
			filePath: undefined,
			kind: "place",
			outputs: { versionNumber: undefined },
			placeId: PLACE_ID,
			serverSize: 50,
		});
	});

	it("should noop a config-only place whose recorded state already matches", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: PLACES_CONFIG_ONLY_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired({
			readFile: readPlaceFileAsync,
			resources: flattenConfig(resolved.data),
		});
		assert(desiredResult.success);

		const [desired] = desiredResult.data.filter(
			(entry): entry is PlaceDesiredState => entry.kind === "place",
		);
		assert(desired);

		const httpClient = createFakeHttpClient();
		const registry: DriverRegistry = {
			developerProduct: DEVELOPER_PRODUCT_TRAP,
			gamePass: GAME_PASS_TRAP,
			place: createPlaceDriver({
				client: new PlacesClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile: readPlaceFileAsync,
				universeId: UNIVERSE_ID,
			}),
			universe: UNIVERSE_TRAP,
		};

		const ops = diff(desiredResult.data, [
			{ ...desired, outputs: { versionNumber: undefined } },
		]);

		expect(ops.map((op) => op.type)).toStrictEqual(["noop"]);

		await applyOps(ops, registry);

		expect(httpClient.requests).toBeEmpty();
	});
});
