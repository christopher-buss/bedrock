import {
	asRobloxAssetId,
	createPlaceDriver,
	deploy,
	type DriverRegistry,
	type ResourceDriver,
	type ResourceKind,
} from "@bedrock-rbx/core";
import { PlacesClient } from "@bedrock-rbx/ocale/places";

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it, onTestFinished } from "vitest";

import { assertOk } from "../helpers/assert-ok.ts";
import { pruneStateS3Async } from "../helpers/prune-state-s3.ts";
import { isTransientDeployFailure, retryTransientAsync } from "../helpers/retry-transient.ts";
import { HAS_AWS_CREDENTIALS, PLACE_PREFIX, smokeStatePort } from "../helpers/smoke-state-s3.ts";
import { BUCKET, REGION } from "./fixtures/state-s3/coordinates.ts";

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "place.rbxlx");

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID_ENV = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const PLACE_ID_ENV = process.env["ROBLOX_TEST_PLACE_ID"];

// How many past runs stay in the bucket to be read by hand.
const KEEP = 3;

const HAS_SECRETS =
	API_KEY !== undefined &&
	UNIVERSE_ID_ENV !== undefined &&
	PLACE_ID_ENV !== undefined &&
	HAS_AWS_CREDENTIALS;

function isRetryableDeploy(outcome: Awaited<ReturnType<typeof deploy>>): boolean {
	return !outcome.success && isTransientDeployFailure(outcome.err);
}

function unreachableDriver<K extends ResourceKind>(label: string): ResourceDriver<K> {
	return {
		async create() {
			throw new Error(`unreachable: smoke config declares no ${label}`);
		},
	};
}

describe("deploy place to real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should publish a place via deploy and persist state to a real bucket",
		async () => {
			expect.assertions(4);

			// The skipIf above guarantees these are defined at runtime, but the
			// type system cannot see through that, so we re-assert here to keep
			// the rest of the test free of non-null assertions or casts.
			assert(API_KEY !== undefined, "BEDROCK_API_KEY must be set");
			assert(UNIVERSE_ID_ENV !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");
			assert(PLACE_ID_ENV !== undefined, "ROBLOX_TEST_PLACE_ID must be set");

			const universeId = asRobloxAssetId(UNIVERSE_ID_ENV);
			const placeId = asRobloxAssetId(PLACE_ID_ENV);

			const environment = `place-smoke-${String(Date.now())}`;
			const statePort = smokeStatePort(PLACE_PREFIX);

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

			onTestFinished(async () => {
				await pruneStateS3Async({
					bucket: BUCKET,
					keep: KEEP,
					prefix: PLACE_PREFIX,
					region: REGION,
				});
			});

			// Roblox answers a place publish with a 5xx often enough to redden
			// the suite, and ocale deliberately does not retry that in
			// production; re-attempt here instead of loosening that policy.
			const result = await retryTransientAsync({
				isTransient: isRetryableDeploy,
				operation: async () => {
					return deploy({
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
				},
			});

			assertOk(result, "deploy");

			const persistedRead = await statePort.read(environment);
			assertOk(persistedRead, "read");

			const persisted = persistedRead.data.state;
			assert(persisted !== undefined);

			expect(persisted.environment).toBe(environment);
			expect(persisted.resources).toHaveLength(1);

			const resource = persisted.resources[0];
			assert(resource !== undefined);
			assert(resource.kind === "place");

			expect(resource.placeId).toBe(placeId);
			expect(resource.outputs.versionNumber).toBeGreaterThan(0);
		},
		60_000,
	);
});
