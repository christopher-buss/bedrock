import {
	asRobloxAssetId,
	type BedrockState,
	createPlaceDriver,
	deploy,
	type DriverRegistry,
	type ResourceDriver,
	type ResourceKind,
	type StatePort,
} from "@bedrock/core";
import { PlacesClient } from "@bedrock/ocale/places";

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "place.rbxl");

const API_KEY = process.env["ROBLOX_API_KEY"];
const UNIVERSE_ID_ENV = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const PLACE_ID_ENV = process.env["ROBLOX_TEST_PLACE_ID"];

const HAS_SECRETS =
	API_KEY !== undefined && UNIVERSE_ID_ENV !== undefined && PLACE_ID_ENV !== undefined;

function unreachableDriver<K extends ResourceKind>(label: string): ResourceDriver<K> {
	return {
		async create() {
			throw new Error(`unreachable: smoke config declares no ${label}`);
		},
	};
}

describe("deploy place to real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should publish a place via deploy and report a positive versionNumber",
		async () => {
			expect.hasAssertions();

			// The skipIf above guarantees these are defined at runtime, but the
			// type system cannot see through that, so we re-assert here to keep
			// the rest of the test free of non-null assertions or casts.
			assert(API_KEY !== undefined, "ROBLOX_API_KEY must be set");
			assert(UNIVERSE_ID_ENV !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");
			assert(PLACE_ID_ENV !== undefined, "ROBLOX_TEST_PLACE_ID must be set");

			const universeId = asRobloxAssetId(UNIVERSE_ID_ENV);
			const placeId = asRobloxAssetId(PLACE_ID_ENV);

			const writes: Array<BedrockState> = [];
			const statePort: StatePort = {
				async read() {
					return { data: undefined, success: true };
				},
				async write(state) {
					writes.push(state);
					return { data: undefined, success: true };
				},
			};

			const placesClient = new PlacesClient({ apiKey: API_KEY });
			const placeDriver = createPlaceDriver({
				client: placesClient,
				readFile,
				universeId,
			});

			const registry: DriverRegistry = {
				gamePass: unreachableDriver("game passes"),
				place: placeDriver,
				universe: unreachableDriver("universe block"),
			};

			const result = await deploy({
				config: {
					places: {
						"smoke-place": {
							filePath: FIXTURE_PATH,
							placeId,
						},
					},
				},
				environment: "smoke",
				readFile,
				registry,
				statePort,
			});

			assert(
				result.success,
				`deploy failed: ${JSON.stringify(result.success ? null : result.err)}`,
			);

			expect(writes).toHaveLength(1);

			const persisted = writes[0];
			assert(persisted !== undefined);

			expect(persisted.environment).toBe("smoke");
			expect(persisted.resources).toHaveLength(1);

			const resource = persisted.resources[0];
			assert(resource !== undefined);
			assert(resource.kind === "place");

			expect(resource.placeId).toBe(placeId);
			expect(resource.outputs.versionNumber).toBeGreaterThan(0);
		},
	);
});
