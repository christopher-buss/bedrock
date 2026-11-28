import {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	createPlaceDriver,
	deploy,
} from "@bedrock-rbx/core";
import { AssetsClient } from "@bedrock-rbx/ocale/assets";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { createHash } from "node:crypto";
import { assert, describe, it } from "vitest";

import type { ResourceCurrentState } from "#src/core/resources";
import type { Config } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { BADGE_TRAP } from "#tests/helpers/drivers";
import { environmentFrom } from "#tests/helpers/environment";
import { placeCurrent, universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = "1234567890";
const LOBBY_ICON = "assets/lobby.png";
const LOBBY_FILE = "places/lobby.rbxl";
const ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PLACE_BYTES = new Uint8Array([60, 114, 111, 98, 108, 111, 120]);
const FILES: Readonly<Record<string, Uint8Array>> = {
	[LOBBY_FILE]: PLACE_BYTES,
	[LOBBY_ICON]: ICON_BYTES,
};

type FakeHttpClient = ReturnType<typeof createFakeHttpClient>;

const unused = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

const LOBBY_CONFIG: Config = {
	environments: { production: { places: { lobby: { placeId: "4712" } } } },
	places: { lobby: { filePath: LOBBY_FILE, icon: { "en-us": LOBBY_ICON } } },
	universe: { universeId: UNIVERSE_ID },
};

const FIRST_DEPLOY = {
	config: {
		...LOBBY_CONFIG,
		places: { lobby: { icon: { "en-us": LOBBY_ICON } } },
	},
	resources: [universeCurrent()],
} satisfies Parameters<typeof livePlaceIconFixture>[0];

const LOCATION = { body: { location: "https://cdn.example.test/v1/bytes/icon" }, status: 200 };

function operation(id: string, response?: unknown): unknown {
	return {
		done: response !== undefined,
		operationId: id,
		path: `operations/${id}`,
		...(response === undefined ? {} : { response }),
	};
}

function mockImageUpload(assets: FakeHttpClient): FakeHttpClient {
	return assets.mockResponse({ body: operation("op-create"), status: 200 }).mockResponse({
		body: operation("op-create", {
			assetId: "789",
			moderationResult: { moderationState: "Approved" },
			path: "assets/789",
		}),
		status: 200,
	});
}

function mockIconUpdate(assets: FakeHttpClient): FakeHttpClient {
	return assets.mockResponse({ body: operation("op-update"), status: 200 }).mockResponse({
		body: operation("op-update", { assetId: "4712", path: "assets/4712" }),
		status: 200,
	});
}

function mockLiveIcon(assets: FakeHttpClient, iconAssetId: string | undefined): FakeHttpClient {
	return assets.mockResponse({
		body: iconAssetId === undefined ? {} : { icon: `assets/${iconAssetId}` },
		status: 200,
	});
}

function mockLivePlace(http: FakeHttpClient): FakeHttpClient {
	return http.mockResponse({
		body: validPlaceBody({ path: `universes/${UNIVERSE_ID}/places/4712` }),
		status: 200,
	});
}

function sha256Of(bytes: Uint8Array): ReturnType<typeof asSha256Hex> {
	return asSha256Hex(createHash("sha256").update(bytes).digest("hex"));
}

function lobbyWithIcon(): ResourceCurrentState<"place"> {
	return placeCurrent({
		key: asResourceKey("lobby"),
		fileHash: sha256Of(PLACE_BYTES),
		filePath: LOBBY_FILE,
		icon: { "en-us": LOBBY_ICON },
		iconFileHashes: { "en-us": sha256Of(ICON_BYTES) },
		outputs: { iconAssetIds: { "en-us": asRobloxAssetId("789") }, versionNumber: 3 },
		placeId: asRobloxAssetId("4712"),
	});
}

function livePlaceIconFixture({
	config = LOBBY_CONFIG,
	resources = [universeCurrent(), lobbyWithIcon()],
	stored = ICON_BYTES,
}: {
	readonly config?: Config;
	readonly resources?: ReadonlyArray<ResourceCurrentState>;
	readonly stored?: Uint8Array<ArrayBuffer>;
} = {}) {
	const http = createFakeHttpClient();
	const assetsHttp = createFakeHttpClient();
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources, version: 1 } },
	});
	const events: Array<ProgressEvent> = [];
	const clientOptions = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		sleep: async () => {},
	};
	async function readFile(path: string): Promise<Uint8Array> {
		const bytes = FILES[path];
		assert(bytes !== undefined, `unexpected read of ${path}`);
		return bytes;
	}

	const registry: DriverRegistry = {
		badge: BADGE_TRAP,
		developerProduct: unused,
		gamePass: unused,
		place: createPlaceDriver({
			client: new PlacesClient({ ...clientOptions, httpClient: http }),
			icon: {
				assets: new AssetsClient({
					...clientOptions,
					fetch: async () => new Response(stored),
					httpClient: assetsHttp,
				}),
				universes: new UniversesClient({ ...clientOptions, httpClient: http }),
			},
			readFile,
			universeId: asRobloxAssetId(UNIVERSE_ID),
		}),
		universe: unused,
	};
	const options = {
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
	};

	return { assetsHttp, events, http, options, store };
}

function requestLines(httpClient: FakeHttpClient): ReadonlyArray<string> {
	return httpClient.requests.map(({ request }) => `${request.method} ${request.url}`);
}

async function formRequestPart(httpClient: FakeHttpClient, index: number): Promise<JSONValue> {
	const { body } = httpClient.requests[index]!.request;
	assert(body instanceof FormData, "request body should be multipart");
	const part = body.get("request");
	assert(part !== null, "multipart body should have a request part");
	return JSON.parse(typeof part === "string" ? part : await part.text());
}

function lobbyOf(store: ReturnType<typeof fakeStateStore>): ResourceCurrentState | undefined {
	return store.states.get("production")?.resources.find(({ key }) => key === "lobby");
}

describe("live place icon", () => {
	it.for([
		{ label: "changed", live: "555" },
		{ label: "removed", live: undefined },
	])(
		"should report a place icon $label outside bedrock and set the recorded icon again without a publish",
		async ({ live }, { expect }) => {
			expect.hasAssertions();

			const fixture = livePlaceIconFixture();
			mockLivePlace(fixture.http);
			mockIconUpdate(mockLiveIcon(fixture.assetsHttp, live));

			const result = await deploy(fixture.options);

			assert(result.success, JSON.stringify(result));

			expect(fixture.events.filter((event) => event.kind === "liveCheck")).toMatchObject([
				{
					check: {
						edits: [
							{
								key: "lobby",
								fields: [{ current: "789", field: "icon", live }],
								kind: "place",
							},
						],
					},
				},
			]);
			expect(requestLines(fixture.http)).toStrictEqual([
				`GET /cloud/v2/universes/${UNIVERSE_ID}/places/4712`,
			]);
			expect(requestLines(fixture.assetsHttp)).toStrictEqual([
				"GET /assets/v1/assets/4712?readMask=icon",
				"PATCH /assets/v1/assets/4712?updateMask=icon",
				"GET /assets/v1/operations/op-update",
			]);
			await expect(formRequestPart(fixture.assetsHttp, 1)).resolves.toStrictEqual({
				assetId: "4712",
				icon: "assets/789",
			});
			expect(lobbyOf(fixture.store)!.outputs).toStrictEqual({
				iconAssetIds: { "en-us": asRobloxAssetId("789") },
				versionNumber: 3,
			});
		},
	);

	it("should preview a place icon changed outside bedrock as a restoring update", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePlaceIconFixture();
		mockLivePlace(fixture.http);
		mockLiveIcon(fixture.assetsHttp, "555");

		const result = await previewDiffAsync(fixture.options);

		assert(result.success, JSON.stringify(result));

		expect(result.data.liveCheck!.edits).toStrictEqual([
			{
				key: "lobby",
				fields: [{ current: "789", field: "icon", live: "555" }],
				kind: "place",
			},
		]);
		expect(result.data.ops.find(({ key }) => key === "lobby")).toMatchObject({
			changedFields: ["icon"],
			forceIconUpload: true,
			reason: "outOfBandEdit",
			type: "update",
		});
	});

	it("should record a live place icon that matches the declared file on the first deploy without an upload", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePlaceIconFixture(FIRST_DEPLOY);
		mockLivePlace(mockLivePlace(fixture.http));
		mockLiveIcon(
			mockLiveIcon(mockLiveIcon(fixture.assetsHttp, "555"), "555"),
			"555",
		).mockResponse(LOCATION);

		const result = await deploy(fixture.options);

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.assetsHttp).slice(2)).toStrictEqual([
			"GET /assets/v1/assets/4712?readMask=icon",
			"GET /asset-delivery-api/v1/assetId/555",
		]);
		expect(lobbyOf(fixture.store)!.outputs).toStrictEqual({
			iconAssetIds: { "en-us": "555" },
			versionNumber: undefined,
		});
	});

	it("should upload and set the declared place icon on the first deploy when the live icon differs", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePlaceIconFixture({ ...FIRST_DEPLOY, stored: new Uint8Array([1, 2]) });
		mockLivePlace(mockLivePlace(fixture.http)).mockResponse({
			body: validUniverseBody({ user: "users/7777" }),
			status: 200,
		});
		mockIconUpdate(
			mockImageUpload(
				mockLiveIcon(
					mockLiveIcon(mockLiveIcon(fixture.assetsHttp, "555"), "555"),
					"555",
				).mockResponse(LOCATION),
			),
		);

		const result = await deploy(fixture.options);

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.assetsHttp).slice(4)).toStrictEqual([
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4712?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		expect(lobbyOf(fixture.store)!.outputs).toStrictEqual({
			iconAssetIds: { "en-us": "789" },
			versionNumber: undefined,
		});
	});
});
