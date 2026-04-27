import {
	asRobloxAssetId,
	createGistStateAdapter,
	createPlaceDriver,
	deploy,
	type DriverRegistry,
	type ResourceDriver,
	type ResourceKind,
} from "@bedrock/core";
import { PlacesClient } from "@bedrock/ocale/places";

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

import { pruneStateGist } from "../helpers/prune-state-gist.ts";

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "place.rbxlx");

const API_KEY = process.env["ROBLOX_API_KEY"];
const UNIVERSE_ID_ENV = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const PLACE_ID_ENV = process.env["ROBLOX_TEST_PLACE_ID"];
const TOKEN = process.env["GITHUB_TOKEN"];
const GIST_ID = process.env["BEDROCK_TEST_GIST_ID"];

const HAS_SECRETS =
	API_KEY !== undefined &&
	UNIVERSE_ID_ENV !== undefined &&
	PLACE_ID_ENV !== undefined &&
	TOKEN !== undefined &&
	GIST_ID !== undefined;

function unreachableDriver<K extends ResourceKind>(label: string): ResourceDriver<K> {
	return {
		async create() {
			throw new Error(`unreachable: smoke config declares no ${label}`);
		},
	};
}

describe("deploy place to real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should publish a place via deploy and persist state to a real gist",
		async () => {
			expect.assertions(4);

			// The skipIf above guarantees these are defined at runtime, but the
			// type system cannot see through that, so we re-assert here to keep
			// the rest of the test free of non-null assertions or casts.
			assert(API_KEY !== undefined, "ROBLOX_API_KEY must be set");
			assert(UNIVERSE_ID_ENV !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");
			assert(PLACE_ID_ENV !== undefined, "ROBLOX_TEST_PLACE_ID must be set");
			assert(TOKEN !== undefined, "GITHUB_TOKEN must be set");
			assert(GIST_ID !== undefined, "BEDROCK_TEST_GIST_ID must be set");

			const universeId = asRobloxAssetId(UNIVERSE_ID_ENV);
			const placeId = asRobloxAssetId(PLACE_ID_ENV);

			const environment = `place-smoke-${String(Date.now())}`;
			const statePort = createGistStateAdapter({ gistId: GIST_ID, token: TOKEN });

			const placesClient = new PlacesClient({ apiKey: API_KEY });
			const placeDriver = createPlaceDriver({
				client: placesClient,
				readFile,
				universeId,
			});

			const registry = {
				developerProduct: unreachableDriver("developer products"),
				gamePass: unreachableDriver("game passes"),
				place: placeDriver,
				universe: unreachableDriver("universe block"),
			} satisfies DriverRegistry;

			try {
				const result = await deploy({
					config: {
						environments: {
							[environment]: {
								places: { "smoke-place": { placeId } },
							},
						},
						places: {
							"smoke-place": {
								filePath: FIXTURE_PATH,
							},
						},
					},
					environment,
					readFile,
					registry,
					statePort,
				});

				assert(
					result.success,
					`deploy failed: ${JSON.stringify(result.success ? null : result.err)}`,
				);

				const persistedRead = await statePort.read(environment);
				assert(
					persistedRead.success,
					`read failed: ${JSON.stringify(persistedRead.success ? undefined : persistedRead.err)}`,
				);

				const persisted = persistedRead.data;
				assert(persisted !== undefined);

				expect(persisted.environment).toBe(environment);
				expect(persisted.resources).toHaveLength(1);

				const resource = persisted.resources[0];
				assert(resource !== undefined);
				assert(resource.kind === "place");

				expect(resource.placeId).toBe(placeId);
				expect(resource.outputs.versionNumber).toBeGreaterThan(0);
			} finally {
				await pruneStateGist({
					filenamePrefix: "state.place-smoke-",
					gistId: GIST_ID,
					keep: 3,
					token: TOKEN,
				});
			}
		},
		60_000,
	);
});
