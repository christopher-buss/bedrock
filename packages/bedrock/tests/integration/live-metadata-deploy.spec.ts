import {
	asRobloxAssetId,
	createPlaceDriver,
	createUniverseDriver,
	deploy,
} from "@bedrock-rbx/core";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import type { ResourceCurrentState } from "#src/core/resources";
import type { Config } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import { environmentFrom } from "#tests/helpers/environment";
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

function metadataFixture(
	{ config, resources }: { config: Config; resources: ReadonlyArray<ResourceCurrentState> },
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
		return new Uint8Array([1, 2, 3]);
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
		assert(result.success);

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
		assert(result.success);

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
