import {
	applyOps,
	asRobloxAssetId,
	buildDesired,
	createUniverseDriver,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	type ResourceDriver,
	UNIVERSE_SINGLETON_KEY,
} from "@bedrock/core";
import { PlacesClient } from "@bedrock/ocale/places";
import { createFakeHttpClient, validUniverseBody } from "@bedrock/ocale/testing";
import { UniversesClient } from "@bedrock/ocale/universes";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const UNIVERSE_FIXTURE_DIR = join(FIXTURES_ROOT, "universe");
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const ROOT_PLACE_ID = asRobloxAssetId("4711");

const GAME_PASS_TRAP: ResourceDriver<"gamePass"> = {
	create() {
		throw new Error("GamePassDriver.create must not run for universe fixtures");
	},
};

const PLACE_TRAP: ResourceDriver<"place"> = {
	create() {
		throw new Error("PlaceDriver.create must not run for universe fixtures");
	},
};

async function readFileNever(): Promise<Uint8Array> {
	throw new Error("readFile must not run for a universe-only config");
}

describe("universe pipeline end-to-end", () => {
	it("should reconcile a declared universe through the full loadConfig to applyOps pipeline", async () => {
		expect.assertions(5);

		const loaded = await loadConfig({ cwd: UNIVERSE_FIXTURE_DIR });
		assert(loaded.success);

		const desiredResult = await buildDesired(flattenConfig(loaded.data), readFileNever);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient().mockResponse({
			body: validUniverseBody({
				path: `universes/${UNIVERSE_ID}`,
				rootPlace: `universes/${UNIVERSE_ID}/places/${ROOT_PLACE_ID}`,
			}),
			status: 200,
		});

		const registry: DriverRegistry = {
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: createUniverseDriver({
				places: new PlacesClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				universes: new UniversesClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
			}),
		};

		const ops = diff(desiredResult.data, []);

		expect(ops.map((op) => op.type)).toStrictEqual(["create"]);

		const applyResult = await applyOps(ops, registry);

		assert(applyResult.success);

		expect(applyResult.data).toHaveLength(1);
		expect(applyResult.data[0]).toStrictEqual({
			key: UNIVERSE_SINGLETON_KEY,
			consoleEnabled: undefined,
			desktopEnabled: false,
			displayName: undefined,
			kind: "universe",
			mobileEnabled: undefined,
			outputs: { rootPlaceId: ROOT_PLACE_ID },
			tabletEnabled: undefined,
			universeId: UNIVERSE_ID,
			visibility: undefined,
			voiceChatEnabled: true,
			vrEnabled: undefined,
		});

		expect(httpClient.requests).toHaveLength(1);

		const [first] = httpClient.requests;
		assert(first);

		expect(first.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=desktopEnabled,voiceChatEnabled`,
		);
	});

	it("should emit a noop and skip driver dispatch when current state matches the fixture", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: UNIVERSE_FIXTURE_DIR });
		assert(loaded.success);

		const desiredResult = await buildDesired(flattenConfig(loaded.data), readFileNever);
		assert(desiredResult.success);

		const ops = diff(desiredResult.data, [
			{
				key: UNIVERSE_SINGLETON_KEY,
				consoleEnabled: undefined,
				desktopEnabled: false,
				displayName: undefined,
				kind: "universe",
				mobileEnabled: undefined,
				outputs: { rootPlaceId: ROOT_PLACE_ID },
				tabletEnabled: undefined,
				universeId: UNIVERSE_ID,
				visibility: undefined,
				voiceChatEnabled: true,
				vrEnabled: undefined,
			},
		]);

		expect(ops.map((op) => op.type)).toStrictEqual(["noop"]);

		const trapRegistry: DriverRegistry = {
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: {
				create() {
					throw new Error("UniverseDriver.create must not run for noop ops");
				},
				update() {
					throw new Error("UniverseDriver.update must not run for noop ops");
				},
			},
		};

		const applyResult = await applyOps(ops, trapRegistry);

		expect(applyResult.success).toBeTrue();
	});
});
