import {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	createPlaceDriver,
	createUniverseDriver,
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

import { none } from "#src/core/none";
import type { ResourceCurrentState } from "#src/core/resources";
import type { Config } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry, ResourceDriver } from "#src/ports/resource-driver";
import { BADGE_TRAP } from "#tests/helpers/drivers";
import { environmentFrom } from "#tests/helpers/environment";
import { placeCurrent, universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = "1234567890";
const LOBBY_ICON = "assets/lobby.png";
const ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

type FakeHttpClient = ReturnType<typeof createFakeHttpClient>;

const unused = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

function universeBody({
	owner = { user: "users/7777" },
	startPlaceId = "4711",
}: {
	readonly owner?:
		| { readonly group: string; readonly user: undefined }
		| { readonly user: string };
	readonly startPlaceId?: string;
} = {}): unknown {
	return validUniverseBody({
		...owner,
		path: `universes/${UNIVERSE_ID}`,
		rootPlace: `universes/${UNIVERSE_ID}/places/${startPlaceId}`,
	});
}

function operation(id: string, response?: unknown): unknown {
	return {
		done: response !== undefined,
		operationId: id,
		path: `operations/${id}`,
		...(response === undefined ? {} : { response }),
	};
}

function mockImageUpload(
	assets: FakeHttpClient,
	{ assetId = "789", moderationState = "Approved" } = {},
): FakeHttpClient {
	return assets.mockResponse({ body: operation("op-create"), status: 200 }).mockResponse({
		body: operation("op-create", {
			assetId,
			moderationResult: { moderationState },
			path: `assets/${assetId}`,
		}),
		status: 200,
	});
}

function mockIconUpdate(assets: FakeHttpClient, placeId: string): FakeHttpClient {
	return assets.mockResponse({ body: operation("op-update"), status: 200 }).mockResponse({
		body: operation("op-update", { assetId: placeId, path: `assets/${placeId}` }),
		status: 200,
	});
}

function withoutLiveReads({
	list: _list,
	read: _read,
	...driver
}: ResourceDriver<"place">): ResourceDriver<"place"> {
	return driver;
}

function placeIconFixture({
	config,
	files = { [LOBBY_ICON]: ICON_BYTES },
	resources = [],
	withAssets = true,
}: {
	readonly config: Config;
	readonly files?: Readonly<Record<string, Uint8Array>>;
	readonly resources?: ReadonlyArray<ResourceCurrentState>;
	readonly withAssets?: boolean;
}) {
	const http = createFakeHttpClient();
	const assetsHttp = createFakeHttpClient();
	const experienceAssetsHttp = createFakeHttpClient();
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources, version: 1 } },
	});
	const events: Array<ProgressEvent> = [];
	const clientOptions = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		sleep: async () => {},
	};
	async function readFile(path: string): Promise<Uint8Array> {
		const bytes = files[path];
		assert(bytes !== undefined, `unexpected read of ${path}`);
		return bytes;
	}

	const assets = new AssetsClient({ ...clientOptions, httpClient: assetsHttp });
	const places = new PlacesClient({ ...clientOptions, httpClient: http });
	const universes = new UniversesClient({ ...clientOptions, httpClient: http });
	const registry: DriverRegistry = {
		badge: BADGE_TRAP,
		developerProduct: unused,
		gamePass: unused,
		// Live place reads are not under test here; a live run refreshes only the
		// universe, which is how the start place moves.
		place: withoutLiveReads(
			createPlaceDriver({
				client: places,
				...(withAssets ? { icon: { assets, universes } } : {}),
				readFile,
				universeId: asRobloxAssetId(UNIVERSE_ID),
			}),
		),
		universe: createUniverseDriver({
			icon: {
				assets: new AssetsClient({ ...clientOptions, httpClient: experienceAssetsHttp }),
				readFile,
			},
			places,
			universes,
		}),
	};

	return {
		assetsHttp,
		events,
		experienceAssetsHttp,
		http,
		async run({ live = false }: { readonly live?: boolean } = {}) {
			return deploy({
				config,
				environment: "production",
				getEnv: environmentFrom({}),
				live,
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
				readFile,
				registry,
				statePort: store.port,
			});
		},
		store,
	};
}

function placeOf(
	store: ReturnType<typeof fakeStateStore>,
	key: string,
): ResourceCurrentState<"place"> | undefined {
	const place = store.states
		.get("production")
		?.resources.find((resource) => resource.kind === "place" && resource.key === key);
	return place?.kind === "place" ? place : undefined;
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

function sha256Of(bytes: Uint8Array): ReturnType<typeof asSha256Hex> {
	return asSha256Hex(createHash("sha256").update(bytes).digest("hex"));
}

function lobbyWithIcon(): ResourceCurrentState<"place"> {
	return placeCurrent({
		key: asResourceKey("lobby"),
		fileHash: undefined,
		filePath: undefined,
		icon: { "en-us": LOBBY_ICON },
		iconFileHashes: { "en-us": sha256Of(ICON_BYTES) },
		outputs: { iconAssetIds: { "en-us": asRobloxAssetId("789") }, versionNumber: undefined },
		placeId: asRobloxAssetId("4712"),
	});
}

function lobbyConfig(icon?: Record<"en-us", string> | typeof none, displayName?: string): Config {
	return {
		environments: { production: { places: { lobby: { placeId: "4712" } } } },
		places: {
			lobby: {
				...(icon === undefined ? {} : { icon }),
				...(displayName === undefined ? {} : { displayName }),
			},
		},
		universe: { universeId: UNIVERSE_ID },
	};
}

const EXPERIENCE_ICON = "assets/icon.png";
const START_ICON = "assets/start.png";

const BOTH_ICONS: Config = {
	environments: {
		production: {
			places: { "lobby": { placeId: "4712" }, "start-place": { placeId: "4711" } },
		},
	},
	places: {
		"lobby": {},
		"start-place": { icon: { "en-us": LOBBY_ICON } },
	},
	universe: { icon: { "en-us": EXPERIENCE_ICON }, universeId: UNIVERSE_ID },
};

const LOBBY_CONFIG: Config = {
	environments: { production: { places: { lobby: { placeId: "4712" } } } },
	places: { lobby: { icon: { "en-us": LOBBY_ICON } } },
	universe: { universeId: UNIVERSE_ID },
};

describe("place icon", () => {
	it("should upload the icon as the universe owner and set it on a place that is not the start place", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({ config: LOBBY_CONFIG });
		fixture.http.mockResponse({ body: universeBody(), status: 200 }).mockResponse({
			body: universeBody({ owner: { group: "groups/42", user: undefined } }),
			status: 200,
		});
		mockIconUpdate(mockImageUpload(fixture.assetsHttp), "4712");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4712?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPart(fixture.assetsHttp, 0)).resolves.toMatchObject({
			assetType: "Image",
			creationContext: { creator: { groupId: "42" } },
			displayName: "Place icon",
		});
		await expect(formRequestPart(fixture.assetsHttp, 2)).resolves.toStrictEqual({
			assetId: "4712",
			icon: "assets/789",
		});
		expect(placeOf(fixture.store, "lobby")!.outputs).toStrictEqual({
			iconAssetIds: { "en-us": asRobloxAssetId("789") },
			versionNumber: undefined,
		});
	});

	it("should remove the icon from the place when the config sets it to none", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: lobbyConfig(none),
			resources: [universeCurrent(), lobbyWithIcon()],
		});
		mockIconUpdate(fixture.assetsHttp, "4712");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"PATCH /assets/v1/assets/4712?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPart(fixture.assetsHttp, 0)).resolves.toStrictEqual({
			assetId: "4712",
			icon: "",
		});
		expect(fixture.http.requests).toBeEmpty();
		expect(placeOf(fixture.store, "lobby")!.outputs).toStrictEqual({
			versionNumber: undefined,
		});
	});

	it("should send nothing for an omitted icon on a place with a recorded icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: lobbyConfig(),
			resources: [universeCurrent(), lobbyWithIcon()],
		});

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(fixture.assetsHttp.requests).toBeEmpty();
		expect(fixture.http.requests).toBeEmpty();
	});

	it("should fail the place when its driver has no assets client for the icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: LOBBY_CONFIG,
			resources: [universeCurrent()],
			withAssets: false,
		});

		const result = await fixture.run();

		expect(result.success).toBeFalse();
		expect(fixture.events.find((event) => event.kind === "resourceOpFailed")).toMatchObject({
			key: "lobby",
			error: {
				cause: {
					message:
						"Place driver needs an assets client and a universes client to set the icon of 'lobby'",
				},
			},
			resourceKind: "place",
		});
		expect(fixture.assetsHttp.requests).toBeEmpty();
	});

	it("should neither upload nor set the icon when the icon file is unchanged", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: lobbyConfig({ "en-us": LOBBY_ICON }),
			resources: [universeCurrent(), lobbyWithIcon()],
		});

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(fixture.assetsHttp.requests).toBeEmpty();
		expect(fixture.http.requests).toBeEmpty();
	});

	it("should keep the recorded icon when only another place field changes", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: lobbyConfig({ "en-us": LOBBY_ICON }, "Lobby"),
			resources: [universeCurrent(), lobbyWithIcon()],
		});
		fixture.http.mockResponse({ body: validPlaceBody({ displayName: "Lobby" }), status: 200 });

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(fixture.assetsHttp.requests).toBeEmpty();
		expect(requestLines(fixture.http)).toStrictEqual([
			`PATCH /cloud/v2/universes/${UNIVERSE_ID}/places/4712?updateMask=displayName`,
		]);
		expect(placeOf(fixture.store, "lobby")!.outputs).toStrictEqual({
			iconAssetIds: { "en-us": asRobloxAssetId("789") },
			versionNumber: undefined,
		});
	});

	it("should give the start place the experience icon and warn about the place key when the universe declares an icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: BOTH_ICONS,
			files: { [EXPERIENCE_ICON]: ICON_BYTES, [LOBBY_ICON]: ICON_BYTES },
		});
		fixture.http
			.mockResponse({ body: universeBody(), status: 200 })
			.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockImageUpload(fixture.experienceAssetsHttp), "4711");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.experienceAssetsHttp)).toStrictEqual([
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4711?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPart(fixture.experienceAssetsHttp, 0)).resolves.toMatchObject({
			displayName: "Experience icon",
		});
		expect(
			fixture.events.filter(({ kind }) => kind === "startPlaceFieldSkipped"),
		).toStrictEqual([
			{
				key: "start-place",
				environment: "production",
				field: "icon",
				kind: "startPlaceFieldSkipped",
			},
		]);
		expect(placeOf(fixture.store, "start-place")!.outputs).toStrictEqual({
			versionNumber: undefined,
		});
	});

	it("should keep the experience icon on the start place when the start place sets its icon to none", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: {
				...BOTH_ICONS,
				places: { "start-place": { icon: none } },
			},
			files: { [EXPERIENCE_ICON]: ICON_BYTES },
		});
		fixture.http
			.mockResponse({ body: universeBody(), status: 200 })
			.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockImageUpload(fixture.experienceAssetsHttp), "4711");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.experienceAssetsHttp)).toStrictEqual([
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4711?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		expect(
			fixture.events.filter(({ kind }) => kind === "startPlaceFieldSkipped"),
		).toMatchObject([{ key: "start-place", field: "icon" }]);
	});

	it("should give the start place its own icon when the universe declares none", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: {
				...BOTH_ICONS,
				places: { "start-place": { icon: { "en-us": LOBBY_ICON } } },
				universe: { universeId: UNIVERSE_ID },
			},
			resources: [universeCurrent()],
		});
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockImageUpload(fixture.assetsHttp), "4711");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		await expect(formRequestPart(fixture.assetsHttp, 0)).resolves.toMatchObject({
			displayName: "Place icon",
		});
		expect(requestLines(fixture.assetsHttp)).toContain(
			"PATCH /assets/v1/assets/4711?updateMask=icon",
		);
		expect(fixture.events.map(({ kind }) => kind)).not.toContain("startPlaceFieldSkipped");
	});

	it("should give the former start place its own icon once the start place changes", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: {
				...BOTH_ICONS,
				places: {
					"lobby": { icon: { "en-us": LOBBY_ICON } },
					"start-place": { icon: { "en-us": START_ICON } },
				},
			},
			files: {
				[EXPERIENCE_ICON]: ICON_BYTES,
				[LOBBY_ICON]: ICON_BYTES,
				[START_ICON]: ICON_BYTES,
			},
		});
		fixture.http
			.mockResponse({ body: universeBody(), status: 200 })
			.mockResponse({ body: universeBody(), status: 200 })
			.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockImageUpload(fixture.experienceAssetsHttp), "4711");
		mockIconUpdate(mockImageUpload(fixture.assetsHttp, { assetId: "790" }), "4712");
		const first = await fixture.run();
		assert(first.success, JSON.stringify(first));
		fixture.events.length = 0;
		const moved = universeBody({ startPlaceId: "4712" });
		fixture.http
			.mockResponse({ body: moved, status: 200 })
			.mockResponse({ body: moved, status: 200 })
			.mockResponse({ body: moved, status: 200 })
			.mockResponse({ body: moved, status: 200 });
		mockIconUpdate(fixture.experienceAssetsHttp, "4712");
		mockIconUpdate(mockImageUpload(fixture.assetsHttp, { assetId: "791" }), "4711");

		const second = await fixture.run({ live: true });

		assert(second.success, JSON.stringify(second));

		expect(requestLines(fixture.experienceAssetsHttp).slice(4)).toStrictEqual([
			"PATCH /assets/v1/assets/4712?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		expect(requestLines(fixture.assetsHttp).slice(4)).toStrictEqual([
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4711?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		expect(
			fixture.events.filter(({ kind }) => kind === "startPlaceFieldSkipped"),
		).toMatchObject([{ key: "lobby", field: "icon" }]);
		expect(placeOf(fixture.store, "start-place")!.outputs).toStrictEqual({
			iconAssetIds: { "en-us": asRobloxAssetId("791") },
			versionNumber: undefined,
		});
	});
});
