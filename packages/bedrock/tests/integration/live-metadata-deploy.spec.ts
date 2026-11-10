import {
	asRobloxAssetId,
	asSha256Hex,
	createPlaceDriver,
	createUniverseDriver,
	deploy,
	none,
} from "@bedrock-rbx/core";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	validGamePassBody,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import type { ResourceCurrentState } from "#src/core/resources";
import { SOCIAL_LINK_FIELDS } from "#src/core/resources";
import type { Config } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import { environmentFrom } from "#tests/helpers/environment";
import { livePassFixture } from "#tests/helpers/live-game-pass";
import { placeCurrent, universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const unused = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

const PLACE_BYTES = [
	0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x21, 0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a,
];

function metadataFixture(
	{
		config,
		fileBytes = new Uint8Array([1, 2, 3]),
		resources,
	}: { config: Config; fileBytes?: Uint8Array; resources: ReadonlyArray<ResourceCurrentState> },
	httpClient: ReturnType<typeof createFakeHttpClient>,
) {
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources, version: 1 } },
	});
	const events: Array<ProgressEvent> = [];
	const clientOptions = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		httpClient,
		sleep: async () => {},
	};
	const places = new PlacesClient(clientOptions);
	async function readFile(): Promise<Uint8Array> {
		return fileBytes;
	}

	const registry: DriverRegistry = {
		badge: unused,
		developerProduct: unused,
		gamePass: unused,
		place: createPlaceDriver({
			client: places,
			readFile,
			universeId: asRobloxAssetId("1234567890"),
		}),
		universe: createUniverseDriver({ places, universes: new UniversesClient(clientOptions) }),
	};
	return {
		events,
		options: {
			config,
			environment: "production",
			getEnv: environmentFrom({}),
			progress: {
				emit: (event: ProgressEvent) => {
					events.push(event);
				},
			},
			readFile,
			registry,
			statePort: store.port,
		},
		store,
	};
}

describe("adopted metadata deploy", () => {
	it("should preserve default-managed game-pass fields while limiting adopted ownership", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({
				body: {
					gamePasses: [
						validGamePassBody({
							name: "VIP Pass",
							description: "Grants VIP perks.",
							gamePassId: 9_876_543_210,
							iconAssetId: 1_122_334_455,
							isManagedPricingEnabled: true,
							priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
						}),
					],
					nextPageToken: JSON.parse("null"),
				},
				status: 200,
			})
			.mockResponse({ status: 204 });
		const fixture = livePassFixture(500, http);
		const result = await deploy(fixture.options);
		assert(result.success, JSON.stringify(result));
		const { body } = http.requests[1]!.request;
		assert(body instanceof FormData);

		expect(body.get("isManagedPricingEnabled")).toBe("false");
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["GET", "PATCH"]);
		expect(result.data.resources).toMatchObject([{ isManagedPricingEnabled: false }]);
	});

	it("should restore managed false settings while applying a private-server config change from zero", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = universeCurrent({
			desktopEnabled: false,
			privateServerPriceRobux: 0,
			voiceChatEnabled: false,
		});
		const http = createFakeHttpClient()
			.mockResponse({
				body: validUniverseBody({
					desktopEnabled: true,
					privateServerPriceRobux: 100,
					voiceChatEnabled: true,
				}),
				status: 200,
			})
			.mockResponse({
				body: validUniverseBody({
					desktopEnabled: false,
					privateServerPriceRobux: 50,
					rootPlace: "universes/1234567890/places/4711",
					voiceChatEnabled: false,
				}),
				status: 200,
			});
		const fixture = metadataFixture(
			{
				config: {
					environments: { production: {} },
					universe: {
						desktopEnabled: false,
						privateServerPriceRobux: 50,
						universeId: "1234567890",
						voiceChatEnabled: false,
					},
				},
				resources: [current],
			},
			http,
		);
		const result = await deploy(fixture.options);
		assert(result.success, JSON.stringify(result));

		expect(
			http.requests.map(({ request }) => [request.method, request.url, request.body]),
		).toStrictEqual([
			["GET", "/cloud/v2/universes/1234567890", undefined],
			[
				"PATCH",
				"/cloud/v2/universes/1234567890?updateMask=desktopEnabled,voiceChatEnabled,privateServerPriceRobux",
				{ desktopEnabled: false, privateServerPriceRobux: 50, voiceChatEnabled: false },
			],
		]);
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([
			{ ...current, privateServerPriceRobux: 50 },
		]);
		expect(fixture.events).toContainEqual(
			expect.objectContaining({ kind: "applySummary", reverted: 1, updated: 1 }),
		);

		http.mockResponse({
			body: validUniverseBody({
				desktopEnabled: false,
				privateServerPriceRobux: 50,
				voiceChatEnabled: false,
			}),
			status: 200,
		});
		const settled = await deploy(fixture.options);
		assert(settled.success, JSON.stringify(settled));

		expect(http.requests.slice(2).map(({ request }) => request.method)).toStrictEqual(["GET"]);
	});

	it.for([
		{ field: "privateServerPriceRobux", live: 100 },
		...SOCIAL_LINK_FIELDS.map((field) => {
			return { field, live: { title: "External community", uri: "https://example.com" } };
		}),
	])(
		"should retain ownership of explicitly cleared universe $field",
		async ({ field, live }, { expect }) => {
			expect.hasAssertions();

			const current = universeCurrent({ [field]: undefined });
			// As in universe.spec.ts, Roblox documents null clears but its
			// OpenAPI schema omits nullability. Assert the exact runtime wire
			// contract here.
			const http = createFakeHttpClient({ schemaValidation: "off" })
				.mockResponse({ body: validUniverseBody({ [field]: live }), status: 200 })
				.mockResponse({
					body: validUniverseBody({ rootPlace: "universes/1234567890/places/4711" }),
					status: 200,
				});
			const fixture = metadataFixture(
				{
					config: {
						environments: { production: {} },
						universe: { [field]: none, universeId: "1234567890" },
					},
					resources: [current],
				},
				http,
			);
			const result = await deploy(fixture.options);
			assert(result.success, JSON.stringify(result));

			expect(
				http.requests.map(({ request }) => [request.method, request.url, request.body]),
			).toStrictEqual([
				["GET", "/cloud/v2/universes/1234567890", undefined],
				[
					"PATCH",
					`/cloud/v2/universes/1234567890?updateMask=${field}`,
					{ [field]: JSON.parse("null") },
				],
			]);
			expect(fixture.store.states.get("production")!.resources).toStrictEqual([current]);

			http.mockResponse({ body: validUniverseBody(), status: 200 });
			const settled = await deploy(fixture.options);
			assert(settled.success, JSON.stringify(settled));

			expect(http.requests.slice(2).map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
		},
	);

	it("should keep unmanaged adopted settings unmanaged after persisting and refetching the live baseline", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const resources = [
			universeCurrent({ desktopEnabled: true }),
			placeCurrent({ displayName: "Lobby", fileHash: undefined, filePath: undefined }),
		];
		const http = createFakeHttpClient()
			.mockResponse({
				body: validPlaceBody({
					description: "External welcome",
					displayName: "Lobby",
					serverSize: 30,
				}),
				status: 200,
			})
			.mockResponse({ body: validUniverseBody({ desktopEnabled: true }), status: 200 })
			.mockResponse({
				body: validPlaceBody({
					description: "Another external welcome",
					displayName: "Lobby",
					serverSize: 99,
				}),
				status: 200,
			})
			.mockResponse({
				body: validUniverseBody({
					consoleEnabled: true,
					desktopEnabled: true,
					discordSocialLink: { title: "External community", uri: "https://example.com" },
					displayName: "External universe",
					privateServerPriceRobux: 999,
					voiceChatEnabled: true,
				}),
				status: 200,
			});
		const fixture = metadataFixture(
			{
				config: {
					environments: {
						production: { places: { "start-place": { placeId: "4711" } } },
					},
					places: { "start-place": { displayName: "Lobby" } },
					universe: { desktopEnabled: true, universeId: "1234567890" },
				},
				resources,
			},
			http,
		);
		const first = await deploy(fixture.options);
		assert(first.success, JSON.stringify(first));

		expect(fixture.store.states.get("production")!.resources).toStrictEqual(resources);

		const second = await deploy(fixture.options);
		assert(second.success, JSON.stringify(second));

		expect(second.data.resources).toStrictEqual(resources);
		expect(
			fixture.events
				.filter((event) => event.kind === "liveCheck")
				.map((event) => event.check.edits),
		).toStrictEqual([[], []]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
			"GET",
			"GET",
			"GET",
		]);
	});

	it.for([
		{
			change: "file content",
			fileBytes: new Uint8Array([...PLACE_BYTES, 0xcc]),
			filePath: "places/start.rbxl",
			placeId: "4711",
		},
		{
			change: "source path",
			fileBytes: new Uint8Array(PLACE_BYTES),
			filePath: "places/new.rbxl",
			placeId: "4711",
		},
		{
			change: "adopted ID",
			fileBytes: new Uint8Array(PLACE_BYTES),
			filePath: "places/start.rbxl",
			placeId: "832",
		},
	])(
		"should still publish when a metadata revert accompanies changed $change",
		async ({ fileBytes, filePath, placeId }, { expect }) => {
			expect.hasAssertions();

			const current = placeCurrent({
				description: "Welcome",
				displayName: "Lobby",
				fileHash: asSha256Hex(
					"f992e69002eecd9e0cd7f8a4a147f21bf55dc1e3240fdeaea6773d426fecf40c",
				),
				serverSize: 20,
			});
			const http = createFakeHttpClient()
				.mockResponse({
					body: validPlaceBody({
						description: "Welcome",
						displayName: "Edited lobby",
						serverSize: 20,
					}),
					status: 200,
				})
				.mockResponse({ body: { versionNumber: 2 }, status: 200 })
				.mockResponse({
					body: validPlaceBody({
						description: "Welcome",
						displayName: "Lobby",
						serverSize: 20,
					}),
					status: 200,
				});
			const fixture = metadataFixture(
				{
					config: {
						environments: { production: { places: { "start-place": { placeId } } } },
						places: {
							"start-place": {
								description: "Welcome",
								displayName: "Lobby",
								filePath,
								serverSize: 20,
							},
						},
					},
					fileBytes,
					resources: [current],
				},
				http,
			);
			const { options } = fixture;
			const result = await deploy(options);
			assert(result.success, JSON.stringify(result));

			expect(http.requests.map(({ request }) => [request.method, request.url])).toStrictEqual(
				[
					["GET", "/cloud/v2/universes/1234567890/places/4711"],
					[
						"POST",
						`/universes/v1/1234567890/places/${placeId}/versions?versionType=Published`,
					],
					[
						"PATCH",
						`/cloud/v2/universes/1234567890/places/${placeId}?updateMask=displayName`,
					],
				],
			);
			expect(result.data.resources).toMatchObject([
				{ displayName: "Lobby", outputs: { versionNumber: 2 } },
			]);

			http.mockResponse({
				body: validPlaceBody({
					description: "Welcome",
					displayName: "Lobby",
					serverSize: 20,
				}),
				status: 200,
			});
			const settled = await deploy(options);
			assert(settled.success, JSON.stringify(settled));

			expect(http.requests.slice(3).map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
		},
	);

	it("should restore an edited place name alongside config drift without republishing unchanged content", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = placeCurrent({
			description: "Welcome",
			displayName: "Lobby",
			serverSize: 20,
		});
		const http = createFakeHttpClient()
			.mockResponse({
				body: validPlaceBody({
					description: "Welcome",
					displayName: "Edited lobby",
					serverSize: 20,
				}),
				status: 200,
			})
			.mockResponse({
				body: validPlaceBody({
					description: "New welcome",
					displayName: "Lobby",
					serverSize: 20,
				}),
				status: 200,
			});
		const fixture = metadataFixture(
			{
				config: {
					environments: {
						production: { places: { "start-place": { placeId: "4711" } } },
					},
					places: {
						"start-place": {
							description: "New welcome",
							displayName: "Lobby",
							filePath: "places/start.rbxl",
							serverSize: 20,
						},
					},
				},
				resources: [current],
			},
			http,
		);
		const result = await deploy(fixture.options);
		assert(result.success, JSON.stringify(result));

		expect(
			http.requests.map(({ request }) => [request.method, request.url, request.body]),
		).toStrictEqual([
			["GET", "/cloud/v2/universes/1234567890/places/4711", undefined],
			[
				"PATCH",
				"/cloud/v2/universes/1234567890/places/4711?updateMask=displayName,description",
				{ description: "New welcome", displayName: "Lobby" },
			],
		]);
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([
			{ ...current, description: "New welcome" },
		]);
		expect(fixture.events).toContainEqual(
			expect.objectContaining({ kind: "applySummary", reverted: 1, updated: 1 }),
		);

		http.mockResponse({
			body: validPlaceBody({
				description: "New welcome",
				displayName: "Lobby",
				serverSize: 20,
			}),
			status: 200,
		});
		const settled = await deploy(fixture.options);
		assert(settled.success);

		expect(http.requests.slice(2).map(({ request }) => request.method)).toStrictEqual(["GET"]);
		expect(settled.data.resources).toStrictEqual(result.data.resources);
	});

	it("should restore all managed metadata on a config-only place through its single reader", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = placeCurrent({
			description: "Welcome",
			displayName: "Lobby",
			fileHash: undefined,
			filePath: undefined,
			serverSize: 20,
		});
		const http = createFakeHttpClient()
			.mockResponse({
				body: validPlaceBody({
					description: "Edited welcome",
					displayName: "Edited lobby",
					serverSize: 50,
				}),
				status: 200,
			})
			.mockResponse({
				body: validPlaceBody({
					description: "Welcome",
					displayName: "Lobby",
					serverSize: 20,
				}),
				status: 200,
			});
		const fixture = metadataFixture(
			{
				config: {
					environments: {
						production: { places: { "start-place": { placeId: "4711" } } },
					},
					places: {
						"start-place": {
							description: "Welcome",
							displayName: "Lobby",
							serverSize: 20,
						},
					},
				},
				resources: [current],
			},
			http,
		);
		const result = await deploy({
			...fixture.options,
			registry: { ...fixture.options.registry, universe: unused },
		});
		assert(result.success, JSON.stringify(result));

		expect(
			http.requests.map(({ request }) => [request.method, request.url, request.body]),
		).toStrictEqual([
			["GET", "/cloud/v2/universes/1234567890/places/4711", undefined],
			[
				"PATCH",
				"/cloud/v2/universes/1234567890/places/4711?updateMask=displayName,description,serverSize",
				{ description: "Welcome", displayName: "Lobby", serverSize: 20 },
			],
		]);
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([current]);
		expect(fixture.events).toContainEqual(
			expect.objectContaining({ kind: "applySummary", reverted: 1, updated: 1 }),
		);
	});

	it("should restore a universe setting using its single reader, settle State and leave the next deploy a noop", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: validUniverseBody({ desktopEnabled: false }), status: 200 })
			.mockResponse({
				body: validUniverseBody({
					desktopEnabled: true,
					rootPlace: "universes/1234567890/places/4711",
				}),
				status: 200,
			});
		const fixture = metadataFixture(
			{
				config: {
					environments: { production: {} },
					universe: { desktopEnabled: true, universeId: "1234567890" },
				},
				resources: [universeCurrent({ desktopEnabled: true })],
			},
			http,
		);
		const options = {
			...fixture.options,
			registry: { ...fixture.options.registry, place: unused },
		};
		const result = await deploy(options);
		assert(result.success, JSON.stringify(result));

		expect(
			http.requests.map(({ request }) => [request.method, request.url, request.body]),
		).toStrictEqual([
			["GET", "/cloud/v2/universes/1234567890", undefined],
			[
				"PATCH",
				"/cloud/v2/universes/1234567890?updateMask=desktopEnabled",
				{ desktopEnabled: true },
			],
		]);
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([
			universeCurrent({ desktopEnabled: true }),
		]);
		expect(fixture.events).toStrictEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "resourceOpStarted", reason: "outOfBandEdit" }),
				expect.objectContaining({ kind: "applySummary", reverted: 1, updated: 1 }),
			]),
		);

		http.mockResponse({ body: validUniverseBody({ desktopEnabled: true }), status: 200 });
		fixture.events.length = 0;
		const settled = await deploy(options);
		assert(settled.success);

		expect(http.requests.slice(2).map(({ request }) => request.method)).toStrictEqual(["GET"]);
		expect(fixture.events).toContainEqual(
			expect.objectContaining({ kind: "applySummary", noop: 1, updated: 0 }),
		);
	});
});
