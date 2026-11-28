import { asRobloxAssetId, createUniverseDriver, deploy } from "@bedrock-rbx/core";
import { AssetsClient } from "@bedrock-rbx/ocale/assets";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import { createFakeHttpClient, validUniverseBody } from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import type { ResourceCurrentState } from "#src/core/resources";
import type { Config } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
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
import { universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = "1234567890";
const ICON_PATH = "assets/icon.png";
const ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const ICON_CONFIG = {
	environments: { production: {} },
	universe: { icon: { "en-us": ICON_PATH }, universeId: UNIVERSE_ID },
} satisfies Config;

function universeBody(): unknown {
	return validUniverseBody({
		path: `universes/${UNIVERSE_ID}`,
		rootPlace: `universes/${UNIVERSE_ID}/places/4711`,
		user: "users/7777",
	});
}

function universeWithIcon(): ResourceCurrentState<"universe"> {
	return universeCurrent({
		icon: { "en-us": ICON_PATH },
		iconFileHashes: { "en-us": sha256Of(ICON_BYTES) },
		outputs: {
			iconAssetIds: { "en-us": asRobloxAssetId("789") },
			iconStartPlaceId: asRobloxAssetId("4711"),
			rootPlaceId: asRobloxAssetId("4711"),
		},
	});
}

const API_KEY = { apiKey: "fake", kind: "apiKey" } as const;
const OAUTH = { getAccessToken: () => "token", identity: "user-1", kind: "oauth" } as const;
const LOCATION = { body: { location: "https://cdn.example.test/v1/bytes/icon" }, status: 200 };

function liveIconFixture({
	config = ICON_CONFIG,
	credential = API_KEY,
	resources = [],
	stored = ICON_BYTES,
}: {
	readonly config?: Config;
	readonly credential?: typeof API_KEY | typeof OAUTH;
	readonly resources?: ReadonlyArray<ResourceCurrentState>;
	readonly stored?: Uint8Array<ArrayBuffer>;
}) {
	const http = createFakeHttpClient();
	const assetsHttp = createFakeHttpClient();
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources, version: 1 } },
	});
	const events: Array<ProgressEvent> = [];
	const clientOptions = { credential, sleep: async () => {} };
	async function readFile(path: string): Promise<Uint8Array> {
		assert(path === ICON_PATH, `unexpected read of ${path}`);
		return ICON_BYTES;
	}

	const registry = {
		badge: BADGE_TRAP,
		developerProduct: UNUSED_DRIVER,
		gamePass: UNUSED_DRIVER,
		place: UNUSED_DRIVER,
		universe: createUniverseDriver({
			icon: {
				assets: new AssetsClient({
					...clientOptions,
					fetch: async () => new Response(stored),
					httpClient: assetsHttp,
				}),
				readFile,
			},
			places: new PlacesClient({ ...clientOptions, httpClient: http }),
			universes: new UniversesClient({ ...clientOptions, httpClient: http }),
		}),
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

	return {
		assetsHttp,
		events,
		http,
		options,
		async run() {
			return deploy(options);
		},
		store,
	};
}

describe("live experience icon", () => {
	it.for([
		{ label: "changed", live: "555" },
		{ label: "removed", live: undefined },
	])(
		"should report an experience icon $label outside bedrock and set the recorded icon again",
		async ({ live }, { expect }) => {
			expect.hasAssertions();

			const fixture = liveIconFixture({ resources: [universeWithIcon()] });
			fixture.http
				.mockResponse({ body: universeBody(), status: 200 })
				.mockResponse({ body: universeBody(), status: 200 });
			mockIconUpdate(mockLiveIcon(fixture.assetsHttp, live));

			const result = await fixture.run();

			assert(result.success, JSON.stringify(result));

			expect(fixture.events.filter((event) => event.kind === "liveCheck")).toMatchObject([
				{
					check: {
						edits: [
							{
								fields: [{ current: "789", field: "icon", live }],
								kind: "universe",
							},
						],
					},
				},
			]);
			expect(requestLines(fixture.assetsHttp)).toStrictEqual([
				"GET /assets/v1/assets/4711?readMask=icon",
				"PATCH /assets/v1/assets/4711?updateMask=icon",
				"GET /assets/v1/operations/op-update",
			]);
			await expect(formRequestPartAsync(fixture.assetsHttp, 1)).resolves.toStrictEqual({
				assetId: "4711",
				icon: "assets/789",
			});
			expect(fixture.store.states.get("production")!.resources).toMatchObject([
				{ outputs: { iconAssetIds: { "en-us": "789" } } },
			]);
		},
	);

	it("should leave the experience icon unchecked when the credential cannot read it", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveIconFixture({ resources: [universeWithIcon()] });
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		fixture.assetsHttp.mockApiError({ code: "PERMISSION_DENIED", statusCode: 403 });

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(fixture.events.filter((event) => event.kind === "liveCheck")).toMatchObject([
			{ check: { edits: [] } },
		]);
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"GET /assets/v1/assets/4711?readMask=icon",
		]);
	});

	it("should record no live experience icon for a universe that never declared one", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveIconFixture({
			config: { environments: { production: {} }, universe: { universeId: UNIVERSE_ID } },
			resources: [universeCurrent()],
		});
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockLiveIcon(fixture.assetsHttp, "555");

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(fixture.store.states.get("production")!.resources).toMatchObject([
			{ outputs: { rootPlaceId: "4711" } },
		]);
		expect(fixture.store.states.get("production")!.resources[0]!.outputs).not.toHaveProperty(
			"iconAssetIds",
		);
	});

	it("should preview an experience icon changed outside bedrock as a restoring update", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveIconFixture({ resources: [universeWithIcon()] });
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockLiveIcon(fixture.assetsHttp, "555");

		const result = await previewDiffAsync(fixture.options);

		assert(result.success, JSON.stringify(result));

		expect(result.data.liveCheck!.edits).toStrictEqual([
			{
				key: "main",
				fields: [{ current: "789", field: "icon", live: "555" }],
				kind: "universe",
			},
		]);
		expect(result.data.ops).toMatchObject([
			{
				key: "main",
				changedFields: ["icon"],
				forceIconUpload: true,
				reason: "outOfBandEdit",
				type: "update",
			},
		]);
	});

	it("should record a live experience icon that matches the declared file on the first deploy without an upload", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveIconFixture({});
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockLiveIcon(fixture.assetsHttp, "555").mockResponse(LOCATION);

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"GET /assets/v1/assets/4711?readMask=icon",
			"GET /asset-delivery-api/v1/assetId/555",
		]);
		expect(fixture.store.states.get("production")!.resources[0]!.outputs).toStrictEqual({
			iconAssetIds: { "en-us": "555" },
			iconStartPlaceId: "4711",
			rootPlaceId: "4711",
		});
	});

	it.for([
		{
			name: "the live icon differs from the declared file",
			credential: API_KEY,
			download: (assets: FakeHttpClient) => assets.mockResponse(LOCATION),
			stored: new Uint8Array([1, 2, 3]),
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
		"should upload and set the declared experience icon on the first deploy when $name",
		async ({ credential, download, stored }, { expect }) => {
			expect.hasAssertions();

			const fixture = liveIconFixture({ credential, stored });
			fixture.http.mockResponse({ body: universeBody(), status: 200 });
			mockIconUpdate(mockImageUpload(download(mockLiveIcon(fixture.assetsHttp, "555"))));

			const result = await fixture.run();

			assert(result.success, JSON.stringify(result));

			expect(requestLines(fixture.assetsHttp).slice(2)).toStrictEqual([
				"POST /assets/v1/assets",
				"GET /assets/v1/operations/op-create",
				"PATCH /assets/v1/assets/4711?updateMask=icon",
				"GET /assets/v1/operations/op-update",
			]);
			expect(fixture.store.states.get("production")!.resources[0]!.outputs).toMatchObject({
				iconAssetIds: { "en-us": "789" },
			});
		},
	);

	it("should read no experience icon from a universe with no start place", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = liveIconFixture({ resources: [universeWithIcon()] });
		fixture.http.mockResponse({
			body: validUniverseBody({ path: `universes/${UNIVERSE_ID}`, rootPlace: undefined }),
			status: 200,
		});

		const result = await previewDiffAsync(fixture.options);

		assert(result.success, JSON.stringify(result));

		expect(fixture.assetsHttp.requests).toBeEmpty();
	});

	it("should upload and set the declared experience icon on the first deploy when the live icon cannot be read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveIconFixture({});
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockImageUpload(fixture.assetsHttp.mockApiError({ statusCode: 403 })));

		const result = await fixture.run();

		assert(result.success, JSON.stringify(result));

		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"GET /assets/v1/assets/4711?readMask=icon",
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4711?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
	});
});
