import { PlacesClient } from "@bedrock/ocale/places";
import { createFakeHttpClient } from "@bedrock/ocale/testing";

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
} from "bedrock";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PLACES_FIXTURE_DIR = join(FIXTURES_ROOT, "places");
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const PLACE_ID = asRobloxAssetId("4711");
const RBXL_BYTES = new Uint8Array([
	0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x21, 0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const GAME_PASS_TRAP: ResourceDriver<"gamePass"> = {
	create() {
		throw new Error("GamePassDriver.create must not run for place fixtures");
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

		const desiredResult = await buildDesired(flattenConfig(loaded.data), readPlaceFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { versionNumber: 1 },
			status: 200,
		});

		const registry: DriverRegistry = {
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
});
