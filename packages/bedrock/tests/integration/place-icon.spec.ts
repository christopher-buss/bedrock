import {
	asResourceKey,
	asRobloxAssetId,
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

import { assert, describe, it } from "vitest";

import { none } from "#src/core/none";
import { REDACTED_ICON_BYTES } from "#src/core/redacted-icon";
import type { ResourceCurrentState } from "#src/core/resources";
import type { Config, PlaceEntry } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry, ResourceDriver } from "#src/ports/resource-driver";
import { previewDiffAsync } from "#src/shell/preview-diff";
import {
	type FakeHttpClient,
	formRequestPartAsync,
	mockIconUpdate,
	mockImageUpload,
	requestLines,
	sha256Of,
	UNUSED_DRIVER,
} from "#tests/helpers/asset-icon";
import { BADGE_TRAP } from "#tests/helpers/drivers";
import { environmentFrom } from "#tests/helpers/environment";
import { placeCurrent, universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = "1234567890";
const LOBBY_ICON = "assets/lobby.png";
const ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

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

function mockLiveIcon(assets: FakeHttpClient, iconAssetId: string | undefined): FakeHttpClient {
	return assets.mockResponse({
		body: iconAssetId === undefined ? {} : { icon: `assets/${iconAssetId}` },
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
	const registry = {
		badge: BADGE_TRAP,
		developerProduct: UNUSED_DRIVER,
		gamePass: UNUSED_DRIVER,
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
	} satisfies DriverRegistry;

	return {
		assetsHttp,
		events,
		experienceAssetsHttp,
		http,
		async preview() {
			return previewDiffAsync({
				config,
				environment: "production",
				getEnv: environmentFrom({}),
				live: true,
				readFile,
				registry,
				statePort: store.port,
			});
		},
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

async function formFilePart(
	httpClient: FakeHttpClient,
	index: number,
): Promise<{ readonly bytes: Uint8Array; readonly type: string }> {
	const { body } = httpClient.requests[index]!.request;
	assert(body instanceof FormData, "request body should be multipart");
	const part = body.get("fileContent");
	assert(part instanceof Blob, "multipart body should have a file part");
	return { bytes: new Uint8Array(await part.arrayBuffer()), type: part.type };
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
const HIDDEN_ICON = "assets/hidden.png";
const START_ICON = "assets/start.png";

const BOTH_ICONS = {
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
} satisfies Config;

const LOBBY_CONFIG = {
	environments: { production: { places: { lobby: { placeId: "4712" } } } },
	places: { lobby: { icon: { "en-us": LOBBY_ICON } } },
	universe: { universeId: UNIVERSE_ID },
} satisfies Config;

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
		mockIconUpdate(mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined)), "4712");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"GET /assets/v1/assets/4712?readMask=icon",
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4712?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPartAsync(fixture.assetsHttp, 1)).resolves.toMatchObject({
			assetType: "Image",
			creationContext: { creator: { groupId: "42" } },
			displayName: "Place icon",
		});
		await expect(formRequestPartAsync(fixture.assetsHttp, 3)).resolves.toStrictEqual({
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
		await expect(formRequestPartAsync(fixture.assetsHttp, 0)).resolves.toStrictEqual({
			assetId: "4712",
			icon: "",
		});
		expect(fixture.http.requests).toBeEmpty();
		expect(placeOf(fixture.store, "lobby")!.outputs).toStrictEqual({
			versionNumber: undefined,
		});
	});

	it("should remove the icon on the first deploy of a place that sets it to none", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: lobbyConfig(none),
			resources: [universeCurrent()],
		});
		mockIconUpdate(fixture.assetsHttp, "4712");

		const first = await fixture.run();
		const second = await fixture.run();

		assert(first.success, JSON.stringify(first));
		assert(second.success, JSON.stringify(second));

		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"PATCH /assets/v1/assets/4712?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPartAsync(fixture.assetsHttp, 0)).resolves.toStrictEqual({
			assetId: "4712",
			icon: "",
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

	it("should set the uploaded icon on the new place when the place ID changes", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: {
				...LOBBY_CONFIG,
				environments: { production: { places: { lobby: { placeId: "4713" } } } },
			},
			resources: [universeCurrent(), lobbyWithIcon()],
		});
		mockIconUpdate(fixture.assetsHttp, "4713");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"PATCH /assets/v1/assets/4713?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPartAsync(fixture.assetsHttp, 0)).resolves.toStrictEqual({
			assetId: "4713",
			icon: "assets/789",
		});
		expect(fixture.http.requests).toBeEmpty();
		expect(placeOf(fixture.store, "lobby")!.outputs).toStrictEqual({
			iconAssetIds: { "en-us": asRobloxAssetId("789") },
			versionNumber: undefined,
		});
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
		mockIconUpdate(
			mockImageUpload(
				mockLiveIcon(mockLiveIcon(fixture.experienceAssetsHttp, undefined), undefined),
			),
			"4711",
		);

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.experienceAssetsHttp)).toStrictEqual([
			"GET /assets/v1/assets/4711?readMask=icon",
			"GET /assets/v1/assets/4711?readMask=icon",
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4711?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPartAsync(fixture.experienceAssetsHttp, 2)).resolves.toMatchObject({
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

	it("should plan no icon update on the start place in a diff preview when the universe declares an icon", async ({
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
		mockIconUpdate(
			mockImageUpload(
				mockLiveIcon(mockLiveIcon(fixture.experienceAssetsHttp, undefined), undefined),
			),
			"4711",
		);
		const deployed = await fixture.run();
		assert(deployed.success, JSON.stringify(deployed));
		fixture.http
			.mockResponse({ body: universeBody(), status: 200 })
			.mockResponse({ body: universeBody(), status: 200 });
		mockLiveIcon(mockLiveIcon(fixture.experienceAssetsHttp, "789"), "789");

		const preview = await fixture.preview();

		assert(preview.success, JSON.stringify(preview));

		expect(
			preview.data.drift!.filter(({ type }) => type !== "noop").map(({ key }) => key),
		).toStrictEqual([]);
		expect(preview.data.startPlaceFieldSkips).toMatchObject([
			{ key: "start-place", field: "icon" },
		]);
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
		mockIconUpdate(
			mockImageUpload(
				mockLiveIcon(mockLiveIcon(fixture.experienceAssetsHttp, undefined), undefined),
			),
			"4711",
		);

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.experienceAssetsHttp)).toStrictEqual([
			"GET /assets/v1/assets/4711?readMask=icon",
			"GET /assets/v1/assets/4711?readMask=icon",
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4711?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		expect(
			fixture.events.filter(({ kind }) => kind === "startPlaceFieldSkipped"),
		).toMatchObject([{ key: "start-place", field: "icon" }]);
	});

	it("should remove the icon from the start place and warn about the place key when the universe sets its icon to none", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({
			config: { ...BOTH_ICONS, universe: { icon: none, universeId: UNIVERSE_ID } },
			resources: [
				universeCurrent({
					icon: { "en-us": EXPERIENCE_ICON },
					iconFileHashes: { "en-us": sha256Of(ICON_BYTES) },
					outputs: {
						iconAssetIds: { "en-us": asRobloxAssetId("789") },
						iconStartPlaceId: asRobloxAssetId("4711"),
						rootPlaceId: asRobloxAssetId("4711"),
					},
				}),
			],
		});
		fixture.http
			.mockResponse({ body: universeBody(), status: 200 })
			.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockLiveIcon(fixture.experienceAssetsHttp, "789"), "4711");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.experienceAssetsHttp)).toStrictEqual([
			"GET /assets/v1/assets/4711?readMask=icon",
			"PATCH /assets/v1/assets/4711?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([]);
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
		mockIconUpdate(mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined)), "4711");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		await expect(formRequestPartAsync(fixture.assetsHttp, 1)).resolves.toMatchObject({
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
		mockIconUpdate(
			mockImageUpload(
				mockLiveIcon(mockLiveIcon(fixture.experienceAssetsHttp, undefined), undefined),
			),
			"4711",
		);
		mockIconUpdate(
			mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined), { assetId: "790" }),
			"4712",
		);
		const first = await fixture.run();
		assert(first.success, JSON.stringify(first));
		fixture.events.length = 0;
		const moved = universeBody({ startPlaceId: "4712" });
		fixture.http
			.mockResponse({ body: moved, status: 200 })
			.mockResponse({ body: moved, status: 200 })
			.mockResponse({ body: moved, status: 200 })
			.mockResponse({ body: moved, status: 200 });
		mockIconUpdate(
			mockLiveIcon(mockLiveIcon(fixture.experienceAssetsHttp, "790"), "790"),
			"4712",
		);
		mockIconUpdate(
			mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined), { assetId: "791" }),
			"4711",
		);

		const second = await fixture.run({ live: true });

		assert(second.success, JSON.stringify(second));

		expect(requestLines(fixture.experienceAssetsHttp).slice(6)).toStrictEqual([
			"GET /assets/v1/assets/4712?readMask=icon",
			"GET /assets/v1/assets/4712?readMask=icon",
			"PATCH /assets/v1/assets/4712?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		expect(requestLines(fixture.assetsHttp).slice(5)).toStrictEqual([
			"GET /assets/v1/assets/4711?readMask=icon",
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

	it("should report an uploaded place icon that moderation is reviewing once and still succeed", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placeIconFixture({ config: LOBBY_CONFIG, resources: [universeCurrent()] });
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(
			mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined), {
				moderationState: "Reviewing",
			}),
			"4712",
		);

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(fixture.events.filter(({ kind }) => kind === "iconPendingModeration")).toStrictEqual(
			[
				{
					key: "lobby",
					environment: "production",
					iconAssetId: "789",
					kind: "iconPendingModeration",
					resourceKind: "place",
				},
			],
		);
	});

	describe("on a redacted place", () => {
		function redactedLobby(
			redacted: NonNullable<PlaceEntry["redacted"]>,
			icon?: PlaceEntry["icon"],
		): Config {
			return {
				environments: { production: { places: { lobby: { placeId: "4712" } } } },
				places: { lobby: { ...(icon === undefined ? {} : { icon }), redacted } },
				universe: { universeId: UNIVERSE_ID },
			};
		}

		it("should upload the embedded placeholder in place of the declared icon", async ({
			expect,
		}) => {
			expect.hasAssertions();

			const fixture = placeIconFixture({
				config: redactedLobby(true, { "en-us": LOBBY_ICON }),
				files: {},
				resources: [universeCurrent()],
			});
			fixture.http
				.mockResponse({ body: validPlaceBody(), status: 200 })
				.mockResponse({ body: universeBody(), status: 200 });
			mockIconUpdate(mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined)), "4712");

			const result = await fixture.run();

			assert(result.success, JSON.stringify(result));

			expect(requestLines(fixture.assetsHttp)).toContain(
				"PATCH /assets/v1/assets/4712?updateMask=icon",
			);
			await expect(formFilePart(fixture.assetsHttp, 1)).resolves.toStrictEqual({
				bytes: new Uint8Array(REDACTED_ICON_BYTES),
				type: "image/png",
			});
		});

		it("should upload the override icon of a redacted place in place of the declared icon", async ({
			expect,
		}) => {
			expect.hasAssertions();

			const hiddenBytes = new Uint8Array([137, 80, 78, 71, 1]);
			const fixture = placeIconFixture({
				config: redactedLobby({ icon: { "en-us": HIDDEN_ICON } }, { "en-us": LOBBY_ICON }),
				files: { [HIDDEN_ICON]: hiddenBytes },
				resources: [universeCurrent()],
			});
			fixture.http
				.mockResponse({ body: validPlaceBody(), status: 200 })
				.mockResponse({ body: universeBody(), status: 200 });
			mockIconUpdate(mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined)), "4712");

			const result = await fixture.run();

			assert(result.success, JSON.stringify(result));

			await expect(formFilePart(fixture.assetsHttp, 1)).resolves.toStrictEqual({
				bytes: hiddenBytes,
				type: "image/png",
			});
		});

		it("should upload the environment's redaction icon on a place it redacts", async ({
			expect,
		}) => {
			expect.hasAssertions();

			const hiddenBytes = new Uint8Array([137, 80, 78, 71, 2]);
			const fixture = placeIconFixture({
				config: {
					...LOBBY_CONFIG,
					environments: {
						production: {
							places: { lobby: { placeId: "4712" } },
							redacted: { icon: { "en-us": HIDDEN_ICON } },
						},
					},
				},
				files: { [HIDDEN_ICON]: hiddenBytes },
				resources: [universeCurrent()],
			});
			fixture.http
				.mockResponse({ body: validPlaceBody(), status: 200 })
				.mockResponse({ body: universeBody(), status: 200 });
			mockIconUpdate(mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined)), "4712");

			const result = await fixture.run();

			assert(result.success, JSON.stringify(result));

			await expect(formFilePart(fixture.assetsHttp, 1)).resolves.toMatchObject({
				bytes: hiddenBytes,
			});
		});

		it("should send no icon write for a redacted place that declares no icon", async ({
			expect,
		}) => {
			expect.hasAssertions();

			const fixture = placeIconFixture({
				config: redactedLobby(true),
				files: {},
				resources: [universeCurrent()],
			});
			fixture.http.mockResponse({ body: validPlaceBody(), status: 200 });

			const result = await fixture.run();

			assert(result.success, JSON.stringify(result));

			expect(fixture.assetsHttp.requests).toBeEmpty();
			expect(placeOf(fixture.store, "lobby")!.outputs).toStrictEqual({
				versionNumber: undefined,
			});
		});

		it("should remove the icon of a redacted place that sets it to none", async ({
			expect,
		}) => {
			expect.hasAssertions();

			const fixture = placeIconFixture({
				config: redactedLobby(true, none),
				files: {},
				resources: [universeCurrent(), lobbyWithIcon()],
			});
			fixture.http.mockResponse({ body: validPlaceBody(), status: 200 });
			mockIconUpdate(fixture.assetsHttp, "4712");

			const result = await fixture.run();

			assert(result.success, JSON.stringify(result));

			expect(requestLines(fixture.assetsHttp)).toStrictEqual([
				"PATCH /assets/v1/assets/4712?updateMask=icon",
				"GET /assets/v1/operations/op-update",
			]);
			await expect(formRequestPartAsync(fixture.assetsHttp, 0)).resolves.toStrictEqual({
				assetId: "4712",
				icon: "",
			});
		});
	});
});
