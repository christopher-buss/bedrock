import { asResourceKey, asRobloxAssetId, createPlaceDriver, deploy } from "@bedrock-rbx/core";
import { AssetsClient } from "@bedrock-rbx/ocale/assets";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it, vi } from "vitest";

import { LIVE_ICON_DOWNLOAD_TIMEOUT_MS } from "#src/adapters/asset-icon";
import type { ResourceCurrentState } from "#src/core/resources";
import type { Config } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import { INTERRUPT_GRACE_MS } from "#src/shell/interrupt";
import { previewDiffAsync } from "#src/shell/preview-diff";
import {
	type FakeHttpClient,
	formRequestPartAsync,
	mockIconUpdate,
	mockImageUpload,
	mockLiveIcon,
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
const LOBBY_FILE = "places/lobby.rbxl";
const ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PLACE_BYTES = new Uint8Array([60, 114, 111, 98, 108, 111, 120]);
const FILES: Readonly<Record<string, Uint8Array>> = {
	[LOBBY_FILE]: PLACE_BYTES,
	[LOBBY_ICON]: ICON_BYTES,
};

const LOBBY_CONFIG = {
	environments: { production: { places: { lobby: { placeId: "4712" } } } },
	places: { lobby: { filePath: LOBBY_FILE, icon: { "en-us": LOBBY_ICON } } },
	universe: { universeId: UNIVERSE_ID },
} satisfies Config;

const FIRST_DEPLOY = {
	config: {
		...LOBBY_CONFIG,
		places: { lobby: { icon: { "en-us": LOBBY_ICON } } },
	},
	resources: [universeCurrent()],
} satisfies Parameters<typeof livePlaceIconFixture>[0];

const LOCATION = { body: { location: "https://cdn.example.test/v1/bytes/icon" }, status: 200 };

const API_KEY = { apiKey: "fake", kind: "apiKey" } as const;
const OAUTH = { getAccessToken: () => "token", identity: "user-1", kind: "oauth" } as const;

function mockLivePlace(http: FakeHttpClient): FakeHttpClient {
	return http.mockResponse({
		body: validPlaceBody({ path: `universes/${UNIVERSE_ID}/places/4712` }),
		status: 200,
	});
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
	cdnFetch = async () => new Response(stored),
	config = LOBBY_CONFIG,
	credential = API_KEY,
	resources = [universeCurrent(), lobbyWithIcon()],
	stored = ICON_BYTES,
}: {
	readonly cdnFetch?: (url: string, init: RequestInit) => Promise<Response>;
	readonly config?: Config;
	readonly credential?: typeof API_KEY | typeof OAUTH;
	readonly resources?: ReadonlyArray<ResourceCurrentState>;
	readonly stored?: Uint8Array<ArrayBuffer>;
} = {}) {
	const http = createFakeHttpClient();
	const assetsHttp = createFakeHttpClient();
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources, version: 1 } },
	});
	const events: Array<ProgressEvent> = [];
	const clientOptions = { credential, sleep: async () => {} };
	async function readFile(path: string): Promise<Uint8Array> {
		const bytes = FILES[path];
		assert(bytes !== undefined, `unexpected read of ${path}`);
		return bytes;
	}

	const registry = {
		badge: BADGE_TRAP,
		developerProduct: UNUSED_DRIVER,
		gamePass: UNUSED_DRIVER,
		place: createPlaceDriver({
			client: new PlacesClient({ ...clientOptions, httpClient: http }),
			icon: {
				assets: new AssetsClient({
					...clientOptions,
					fetch: cdnFetch,
					httpClient: assetsHttp,
				}),
				universes: new UniversesClient({ ...clientOptions, httpClient: http }),
			},
			readFile,
			universeId: asRobloxAssetId(UNIVERSE_ID),
		}),
		universe: UNUSED_DRIVER,
	} satisfies DriverRegistry;
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

function lobbyOf(store: ReturnType<typeof fakeStateStore>): ResourceCurrentState | undefined {
	return store.states.get("production")?.resources.find(({ key }) => key === "lobby");
}

/**
 * A CDN fetch that never answers and fails only once its signal aborts.
 *
 * @returns The fetch, and the signal of its first call once it is made.
 */
function stallingCdn(): {
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly started: Promise<AbortSignal>;
} {
	const started = Promise.withResolvers<AbortSignal>();
	return {
		fetch: async (_url, { signal }) => {
			assert(signal !== undefined && signal !== null, "CDN fetch should get a signal");
			started.resolve(signal);
			return new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => {
					reject(new Error("CDN fetch aborted", { cause: signal.reason }));
				});
			});
		},
		started: started.promise,
	};
}

describe("live place icon", () => {
	it("should forget a recorded place icon without a publish once the config stops declaring it", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePlaceIconFixture({
			config: { ...LOBBY_CONFIG, places: { lobby: { filePath: LOBBY_FILE } } },
		});

		const result = await deploy({ ...fixture.options, live: false });

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.http)).toStrictEqual([]);
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([]);
		expect(lobbyOf(fixture.store)).not.toHaveProperty("icon");
		expect(lobbyOf(fixture.store)!.outputs).toStrictEqual({ versionNumber: 3 });
	});

	it.for([
		{ label: "changed", live: "555" },
		{ label: "removed", live: undefined },
	])(
		"should report a place icon $label outside bedrock and set the recorded icon again without a publish",
		async ({ live }, { expect }) => {
			expect.hasAssertions();

			const fixture = livePlaceIconFixture();
			mockLivePlace(fixture.http);
			mockIconUpdate(mockLiveIcon(fixture.assetsHttp, live), "4712");

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
			await expect(formRequestPartAsync(fixture.assetsHttp, 1)).resolves.toStrictEqual({
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
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
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
		expect(vi.getTimerCount()).toBe(0);
	});

	it.for([
		{
			name: "the live icon differs from the declared file",
			credential: API_KEY,
			download: (assets: FakeHttpClient) => assets.mockResponse(LOCATION),
			stored: new Uint8Array([1, 2]),
		},
		{
			name: "the live icon cannot be downloaded",
			credential: API_KEY,
			download: (assets: FakeHttpClient) => assets.mockApiError({ statusCode: 404 }),
			stored: ICON_BYTES,
		},
		{
			name: "an OAuth credential cannot download the live icon",
			credential: OAUTH,
			download: (assets: FakeHttpClient) => assets.mockApiError({ statusCode: 403 }),
			stored: ICON_BYTES,
		},
	])(
		"should upload and set the declared place icon on the first deploy when $name",
		async ({ credential, download, stored }, { expect }) => {
			expect.hasAssertions();

			const fixture = livePlaceIconFixture({ ...FIRST_DEPLOY, credential, stored });
			mockLivePlace(mockLivePlace(fixture.http)).mockResponse({
				body: validUniverseBody({ user: "users/7777" }),
				status: 200,
			});
			mockIconUpdate(
				mockImageUpload(
					download(
						mockLiveIcon(
							mockLiveIcon(mockLiveIcon(fixture.assetsHttp, "555"), "555"),
							"555",
						),
					),
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
		},
	);

	it("should upload and set the declared place icon on the first deploy when the live icon download stalls", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const cdn = stallingCdn();
		const fixture = livePlaceIconFixture({ ...FIRST_DEPLOY, cdnFetch: cdn.fetch });
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

		const deployed = deploy(fixture.options);
		await cdn.started;
		await vi.advanceTimersByTimeAsync(LIVE_ICON_DOWNLOAD_TIMEOUT_MS - 1);

		expect(requestLines(fixture.assetsHttp)).toHaveLength(4);

		await vi.advanceTimersByTimeAsync(1);
		const result = await deployed;

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

	it("should cancel a stalled live icon download when the deploy is interrupted", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const cdn = stallingCdn();
		const fixture = livePlaceIconFixture({ ...FIRST_DEPLOY, cdnFetch: cdn.fetch });
		mockLivePlace(mockLivePlace(fixture.http));
		mockLiveIcon(
			mockLiveIcon(mockLiveIcon(fixture.assetsHttp, "555"), "555"),
			"555",
		).mockResponse(LOCATION);
		const interrupt = new AbortController();

		const deployed = deploy({ ...fixture.options, signal: interrupt.signal });
		const signal = await cdn.started;
		interrupt.abort();
		await vi.advanceTimersByTimeAsync(INTERRUPT_GRACE_MS);
		const isAbortedInGrace = signal.aborted;
		await vi.runAllTimersAsync();
		await deployed;

		expect(isAbortedInGrace).toBeTrue();
	});
});
