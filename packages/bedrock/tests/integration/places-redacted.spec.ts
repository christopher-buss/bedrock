import {
	applyOps,
	asRobloxAssetId,
	buildDesired,
	createPlaceDriver,
	defineConfig,
	diff,
	type DriverRegistry,
	flattenConfig,
	type ResourceCurrentState,
	type ResourceDesiredState,
	type ResourceDriver,
	selectEnvironment,
} from "@bedrock-rbx/core";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import { createFakeHttpClient, validPlaceBody } from "@bedrock-rbx/ocale/testing";

import { REDACTED_DESCRIPTION } from "#src/core/redact-resources";
import { assert, describe, expect, it } from "vitest";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const PLACE_ID = asRobloxAssetId("4711");
const RBXL_BYTES = new Uint8Array([
	0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x21, 0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const DEVELOPER_PRODUCT_TRAP: ResourceDriver<"developerProduct"> = {
	create() {
		throw new Error("DeveloperProductDriver.create must not run for redacted-place fixtures");
	},
};

const GAME_PASS_TRAP: ResourceDriver<"gamePass"> = {
	create() {
		throw new Error("GamePassDriver.create must not run for redacted-place fixtures");
	},
};

const UNIVERSE_TRAP: ResourceDriver<"universe"> = {
	create() {
		throw new Error("UniverseDriver.create must not run for redacted-place fixtures");
	},
};

async function readPlaceFile(): Promise<Uint8Array> {
	return RBXL_BYTES;
}

function findPlaceDesired(
	desired: ReadonlyArray<ResourceDesiredState>,
): Extract<ResourceDesiredState, { readonly kind: "place" }> {
	const entry = desired.find((value) => value.kind === "place");
	assert(entry !== undefined);
	return entry;
}

function persistedPlace(
	desired: ReadonlyArray<ResourceDesiredState>,
	overrides: Partial<ResourceCurrentState<"place">> = {},
): ResourceCurrentState<"place"> {
	return {
		...findPlaceDesired(desired),
		outputs: { versionNumber: 1 },
		...overrides,
	};
}

describe("places-redacted pipeline end-to-end", () => {
	it("should send empty description and the real displayName when a place declares redacted: true", async () => {
		expect.assertions(3);

		const config = defineConfig({
			environments: { production: { places: { "start-place": { placeId: "4711" } } } },
			places: {
				"start-place": {
					description: "The lobby place.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
					redacted: true,
					serverSize: 50,
				},
			},
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readPlaceFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: { versionNumber: 1 }, status: 200 })
			.mockResponse({
				body: validPlaceBody({
					description: REDACTED_DESCRIPTION,
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

		assert(applyResult.success);

		expect(httpClient.requests).toHaveLength(2);

		const [, metadata] = httpClient.requests;
		assert(metadata);

		expect(metadata.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}/places/${PLACE_ID}?updateMask=displayName,description,serverSize`,
		);
		expect(metadata.request.body).toStrictEqual({
			description: REDACTED_DESCRIPTION,
			displayName: "Start Place",
			serverSize: 50,
		});
	});

	it("should compose the displayNamePrefix with an explicit displayName override on a redacted place", async () => {
		expect.assertions(1);

		const config = defineConfig({
			environments: {
				staging: { label: "staging", places: { "start-place": { placeId: "4711" } } },
			},
			places: {
				"start-place": {
					description: "The lobby place.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
					redacted: { displayName: "Hidden" },
				},
			},
		});

		const resolved = selectEnvironment(config, "staging");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readPlaceFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: { versionNumber: 1 }, status: 200 })
			.mockResponse({
				body: validPlaceBody({
					description: REDACTED_DESCRIPTION,
					displayName: "[STAGING] Hidden",
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

		assert(applyResult.success);

		const [, metadata] = httpClient.requests;
		assert(metadata);

		expect(metadata.request.body).toStrictEqual({
			description: REDACTED_DESCRIPTION,
			displayName: "[STAGING] Hidden",
		});
	});

	it("should redact every place description while preserving real displayNames when the env-level toggle is true", async () => {
		expect.assertions(2);

		const config = defineConfig({
			environments: {
				staging: {
					places: { "lobby": { placeId: "2222" }, "start-place": { placeId: "4711" } },
					redacted: true,
				},
			},
			places: {
				"lobby": {
					description: "The hub.",
					displayName: "Lobby",
					filePath: "places/lobby.rbxl",
				},
				"start-place": {
					description: "The lobby place.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
				},
			},
		});

		const resolved = selectEnvironment(config, "staging");
		assert(resolved.success);

		expect(resolved.data.places?.["lobby"]).toStrictEqual({
			description: REDACTED_DESCRIPTION,
			displayName: "Lobby",
			filePath: "places/lobby.rbxl",
			placeId: "2222",
		});
		expect(resolved.data.places?.["start-place"]).toStrictEqual({
			description: REDACTED_DESCRIPTION,
			displayName: "Start Place",
			filePath: "places/start.rbxl",
			placeId: "4711",
		});
	});

	it("should treat a config-side description edit as a noop while redacted stays true", async () => {
		expect.assertions(1);

		const config = defineConfig({
			environments: { production: { places: { "start-place": { placeId: "4711" } } } },
			places: {
				"start-place": {
					description: "Edited copy that must not ship.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
					redacted: true,
				},
			},
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readPlaceFile);
		assert(desiredResult.success);

		const ops = diff(desiredResult.data, [persistedPlace(desiredResult.data)]);

		expect(ops.every((op) => op.type === "noop")).toBeTrue();
	});

	it("should push the real description when an env-overlay flips redacted to false while the root sets true", async () => {
		expect.assertions(1);

		const config = defineConfig({
			environments: {
				production: { places: { "start-place": { placeId: "4711", redacted: false } } },
			},
			places: {
				"start-place": {
					description: "The lobby place.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
					redacted: true,
				},
			},
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		expect(resolved.data.places?.["start-place"]?.description).toBe("The lobby place.");
	});
});
