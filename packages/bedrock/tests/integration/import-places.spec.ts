import {
	asRobloxAssetId,
	createPlaceDriver,
	createUniverseDriver,
	type DriverRegistry,
} from "@bedrock-rbx/core";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import type { ImportItem } from "#src/core/import-plan-types";
import type { Config } from "#src/core/schema";
import { importItemsAsync } from "#src/shell/import-items";
import { environmentFrom } from "#tests/helpers/environment";
import { fakeStateStore } from "#tests/helpers/state-store";

const CONFIG_FILE = "bedrock.config.json";
const LOBBY = asRobloxAssetId("4711");
const STAGING_LOBBY = asRobloxAssetId("5711");

const CONFIG = {
	environments: {
		production: { label: "prod", universe: { universeId: "123" } },
		staging: { label: "staging", universe: { universeId: "456" } },
	},
	state: { backend: "gist", gistId: "abc" },
} satisfies Config;

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

/**
 * Real place and universe Drivers on the fake client; the other Kinds have
 * no list, so they hold no live items.
 *
 * @param http - Fake client that answers every Open Cloud call.
 * @param universeId - Universe the Drivers are bound to.
 * @returns Drivers that read places and the universe through `http`.
 */
function registryFor(http: FakeHttpClient, universeId: string): DriverRegistry {
	const options = {
		credential: { apiKey: "fake", kind: "apiKey" as const },
		httpClient: http,
		sleep: async () => {},
	};
	const places = new PlacesClient(options);
	return {
		badge: trap,
		developerProduct: trap,
		gamePass: trap,
		place: createPlaceDriver({
			client: places,
			readFile: async () => new Uint8Array(),
			universeId: asRobloxAssetId(universeId),
		}),
		universe: createUniverseDriver({ places, universes: new UniversesClient(options) }),
	};
}

/**
 * Answers for listing one universe's single place and reading it.
 *
 * @param http - Fake client to queue the answers on.
 * @param place - Universe, place and what Roblox shows for it.
 * @returns The same client.
 */
function placeAnswers(
	http: FakeHttpClient,
	place: { readonly displayName: string; readonly id: string; readonly universeId: string },
): FakeHttpClient {
	return http
		.mockResponse({
			body: {
				data: [
					{
						id: Number(place.id),
						name: place.displayName,
						description: "",
						universeId: Number(place.universeId),
					},
				],
			},
			status: 200,
		})
		.mockResponse({
			body: validPlaceBody({
				description: "The lobby.",
				displayName: place.displayName,
				path: `universes/${place.universeId}/places/${place.id}`,
				serverSize: 40,
			}),
			status: 200,
		});
}

function setUp() {
	const files = new Map<string, string>([[CONFIG_FILE, JSON.stringify(CONFIG, undefined, "\t")]]);
	const production = placeAnswers(createFakeHttpClient(), {
		id: LOBBY,
		displayName: "[PROD] Lobby",
		universeId: "123",
	}).mockResponse({
		body: validUniverseBody({
			path: "universes/123",
			rootPlace: `universes/123/places/${LOBBY}`,
		}),
		status: 200,
	});
	const staging = placeAnswers(createFakeHttpClient(), {
		id: STAGING_LOBBY,
		displayName: "[STAGING] Lobby",
		universeId: "456",
	});
	return {
		files,
		options: {
			config: CONFIG,
			configFile: CONFIG_FILE,
			environment: "production",
			getEnv: environmentFrom({}),
			linkRegistries: { staging: registryFor(staging, "456") },
			readFile: async () => new Uint8Array(),
			readTextFile: async (path: string) => String(files.get(path)),
			registry: registryFor(production, "123"),
			statePort: fakeStateStore().port,
			writeFile: async (path: string, contents: string | Uint8Array) => {
				files.set(path, String(contents));
			},
		},
		production,
	};
}

describe("importItemsAsync places", () => {
	it("should offer the root place and write a config-only entry with a placeId in each Environment", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { files, options, production } = setUp();
		const result = await importItemsAsync({
			...options,
			choose: async (items, planLinks) => {
				expect(items).toMatchObject([
					{ key: "lobby", kind: "place", robloxId: LOBBY, root: true },
				]);

				const selection = { key: "lobby", kind: "place" as const, robloxId: LOBBY };
				const [link] = planLinks([selection]);

				expect(link).toMatchObject({ environment: "staging", suggested: STAGING_LOBBY });

				return {
					data: {
						selections: [{ ...selection, links: { staging: STAGING_LOBBY } }],
						untrack: [],
					},
					success: true,
				};
			},
		});
		assert(result.success, JSON.stringify(result));

		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			environments: {
				production: { places: { lobby: { placeId: LOBBY } } },
				staging: { places: { lobby: { placeId: STAGING_LOBBY } } },
			},
			places: { lobby: { description: "The lobby.", displayName: "Lobby", serverSize: 40 } },
		});
		expect(JSON.parse(String(files.get(CONFIG_FILE)))).not.toHaveProperty(
			"places.lobby.filePath",
		);
		expect(result.data.refused).toBeEmpty();
		expect(production.requests.every(({ request }) => request.method === "GET")).toBeTrue();
	});

	it("should link a selected place by name with --link auto", async ({ expect }) => {
		expect.hasAssertions();

		const { files, options } = setUp();
		const result = await importItemsAsync({
			...options,
			link: "auto",
			selections: [{ kind: "place", robloxId: LOBBY }],
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.refused).toBeEmpty();
		expect(JSON.parse(String(files.get(CONFIG_FILE)))).toMatchObject({
			environments: { staging: { places: { lobby: { placeId: STAGING_LOBBY } } } },
		});
	});

	it("should fail the import when the places or the universe cannot be read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { options } = setUp();
		const failedList = await importItemsAsync({
			...options,
			registry: registryFor(createFakeHttpClient().mockApiError({ statusCode: 400 }), "123"),
			selections: [{ kind: "place", robloxId: LOBBY }],
		});
		const failedUniverse = await importItemsAsync({
			...options,
			registry: registryFor(
				placeAnswers(createFakeHttpClient(), {
					id: LOBBY,
					displayName: "Lobby",
					universeId: "123",
				}).mockApiError({ statusCode: 403 }),
				"123",
			),
			selections: [{ kind: "place", robloxId: LOBBY }],
		});

		expect(failedList).toMatchObject({
			err: { kind: "liveCheckFailed", resourceKind: "place" },
			success: false,
		});
		expect(failedUniverse).toMatchObject({
			err: { kind: "liveCheckFailed", resourceKind: "universe" },
			success: false,
		});
	});

	it.for([
		["the universe is gone", { config: CONFIG, drivers: {} }],
		["the universe has no reader", { config: CONFIG, drivers: { universe: trap } }],
		[
			"the Environment names no universe",
			{ config: { environments: { production: {} } }, drivers: {} },
		],
	] as const)(
		"should list places without a root place when %s",
		async ([, setup], { expect }) => {
			expect.hasAssertions();

			const { options } = setUp();
			const http = placeAnswers(createFakeHttpClient(), {
				id: LOBBY,
				displayName: "Lobby",
				universeId: "123",
			}).mockApiError({ statusCode: 404 });
			const registry = registryFor(http, "123");
			const chosen: Array<ReadonlyArray<ImportItem>> = [];
			const result = await importItemsAsync({
				...options,
				choose: async (items) => {
					chosen.push(items);
					return { data: { selections: [], untrack: [] }, success: true };
				},
				config: setup.config,
				linkRegistries: {
					staging: { ...registryFor(createFakeHttpClient(), "456"), place: trap },
				},
				registry: { ...registry, ...setup.drivers },
			});
			assert(result.success, JSON.stringify(result));

			expect(chosen[0]).toMatchObject([{ kind: "place", robloxId: LOBBY }]);
			expect(chosen[0]![0]).not.toHaveProperty("root");
			expect(chosen[0]![0]).not.toHaveProperty("unavailable");
		},
	);

	it("should not read the universe when the Environment has no places", async ({ expect }) => {
		expect.hasAssertions();

		const { options } = setUp();
		const http = createFakeHttpClient()
			.mockResponse({ body: { data: [] }, status: 200 })
			.mockApiError({ statusCode: 404 });
		const result = await importItemsAsync({
			...options,
			linkRegistries: {
				staging: { ...registryFor(createFakeHttpClient(), "456"), place: trap },
			},
			registry: registryFor(http, "123"),
			selections: [{ kind: "place", robloxId: LOBBY }],
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.refused).toMatchObject([{ reason: "notLive" }]);
		expect(http.requests).toHaveLength(2);
	});
});
