import {
	asResourceKey,
	asRobloxAssetId,
	createPlaceDriver,
	createUniverseDriver,
} from "@bedrock-rbx/core";
import { ApiError, OpenCloudError } from "@bedrock-rbx/ocale";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import { diffCommand } from "#src/cli/commands/diff";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import { SOCIAL_LINK_FIELDS, UNIVERSE_MANAGED_FLAGS } from "#src/core/resources";
import type { ResourceCurrentState } from "#src/core/resources";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { makeDeps } from "#tests/helpers/reconcile-command";
import { placeCurrent, universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

function metadataRegistry(httpClient: ReturnType<typeof createFakeHttpClient>) {
	const options = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		httpClient,
		sleep: async () => {},
	};
	const places = new PlacesClient(options);
	return {
		place: createPlaceDriver({
			client: places,
			readFile: async () => {
				throw new Error("live metadata must never read a place file");
			},
			universeId: asRobloxAssetId("1234567890"),
		}),
		universe: createUniverseDriver({ places, universes: new UniversesClient(options) }),
	};
}

function universePreview(
	httpClient: ReturnType<typeof createFakeHttpClient>,
	current: ResourceCurrentState<"universe">,
) {
	const { key: _key, kind: _kind, outputs: _outputs, ...entry } = current;
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources: [current], version: 1 } },
	});
	return {
		options: {
			config: {
				environments: { production: {} },
				universe: {
					...Object.fromEntries(
						Object.entries(entry).filter(([, value]) => value !== undefined),
					),
					universeId: current.universeId,
				},
			},
			environment: "production",
			registry: metadataRegistry(httpClient),
			statePort: store.port,
		},
		store,
	};
}

function placePreview(
	httpClient: ReturnType<typeof createFakeHttpClient>,
	current = placeCurrent({ description: "Welcome", displayName: "Lobby", serverSize: 20 }),
) {
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources: [current], version: 1 } },
	});
	return {
		options: {
			config: {
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				places: {
					"start-place": {
						...(current.displayName === undefined
							? {}
							: { displayName: current.displayName }),
						...(current.description === undefined
							? {}
							: { description: current.description }),
						...(current.serverSize === undefined
							? {}
							: { serverSize: current.serverSize }),
						...(current.filePath === undefined ? {} : { filePath: current.filePath }),
					},
				},
			},
			environment: "production",
			readFile: async () => new Uint8Array([1, 2, 3]),
			registry: metadataRegistry(httpClient),
			statePort: store.port,
		},
		store,
	};
}

describe("universe and place live metadata", () => {
	it("should use one get for each tracked adopted resource and correlate metadata by ID", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [
						universeCurrent({ desktopEnabled: true }),
						placeCurrent({
							displayName: "Lobby",
							fileHash: undefined,
							filePath: undefined,
						}),
						placeCurrent({
							key: asResourceKey("arena"),
							fileHash: undefined,
							filePath: undefined,
							placeId: asRobloxAssetId("832"),
							serverSize: 20,
						}),
					],
					version: 1,
				},
			},
		});
		const httpClient = createFakeHttpClient()
			.mockResponse({
				body: validPlaceBody({
					displayName: "Lobby",
					path: "universes/1234567890/places/4711",
				}),
				status: 200,
			})
			.mockResponse({
				body: validPlaceBody({ path: "universes/1234567890/places/832", serverSize: 40 }),
				status: 200,
			})
			.mockResponse({ body: validUniverseBody(), status: 200 });
		const result = await previewDiffAsync({
			config: {
				environments: {
					production: {
						places: { "arena": { placeId: "832" }, "start-place": { placeId: "4711" } },
					},
				},
				places: { "arena": { serverSize: 20 }, "start-place": { displayName: "Lobby" } },
				universe: { desktopEnabled: true, universeId: "1234567890" },
			},
			environment: "production",
			registry: metadataRegistry(httpClient),
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([
			{
				key: "arena",
				fields: [{ current: 20, field: "serverSize", live: 40 }],
				kind: "place",
			},
		]);
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["GET", "/cloud/v2/universes/1234567890/places/4711"],
			["GET", "/cloud/v2/universes/1234567890/places/832"],
			["GET", "/cloud/v2/universes/1234567890"],
		]);
	});

	it("should say place checks cover metadata and cannot check published content", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placePreview(
			createFakeHttpClient().mockResponse({
				body: validPlaceBody({
					description: "Welcome",
					displayName: "Lobby",
					serverSize: 20,
				}),
				status: 200,
			}),
		);
		const preview = await previewDiffAsync(fixture.options);
		assert(preview.success);
		const deps = makeDeps({
			loadProject: async () => {
				return {
					data: { config: fixture.options.config, plugins: EMPTY_PLUGIN_REGISTRY },
					success: true,
				};
			},
			previewDiff: async () => preview,
		});
		await diffCommand(deps)({ env: ["production"] });

		expect(deps.clack!.logMessage).toHaveBeenCalledWith(
			"Live check: checked place (metadata only; published content not checked), universe; skipped badge (no list), developerProduct (no list), gamePass (no list).",
		);
		expect(preview.data.liveCheck!.edits).toStrictEqual([]);
	});

	it.for([new OpenCloudError("read refused"), new ApiError("Forbidden", { statusCode: 403 })])(
		"should refuse a failed place read before reporting a live baseline (%s)",
		async (cause, { expect }) => {
			expect.hasAssertions();

			const httpClient = createFakeHttpClient().mockError(cause);
			const fixture = placePreview(httpClient);

			await expect(previewDiffAsync(fixture.options)).resolves.toStrictEqual({
				err: { cause, kind: "liveCheckFailed", resourceKind: "place" },
				success: false,
			});
			expect(fixture.store.writes).toBeEmpty();
			expect(httpClient.requests).toHaveLength(1);
		},
	);

	it("should report a missing place while retaining its saved file and metadata baseline", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placePreview(
			createFakeHttpClient().mockError(new ApiError("Missing", { statusCode: 404 })),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.missing).toStrictEqual([
			{ key: "start-place", kind: "place", robloxId: "4711" },
		]);
		expect(result.data.ops).toStrictEqual([
			{ key: "start-place", kind: "place", type: "noop" },
		]);
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should report an unset managed server size as an explicit live value", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const body = validPlaceBody({ description: "Welcome", displayName: "Lobby" });
		const { serverSize: _size, ...withoutSize } = body;
		const fixture = placePreview(
			createFakeHttpClient().mockResponse({ body: withoutSize, status: 200 }),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([
			{
				key: "start-place",
				fields: [{ current: 20, field: "serverSize", live: undefined }],
				kind: "place",
			},
		]);
	});

	it("should ignore unmanaged place metadata and published-content timestamps", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = placePreview(
			createFakeHttpClient().mockResponse({
				body: validPlaceBody({ serverSize: 99, updateTime: "2026-11-10T10:00:00Z" }),
				status: 200,
			}),
			placeCurrent(),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([]);
		expect(result.data.ops).toStrictEqual([
			{ key: "start-place", kind: "place", type: "noop" },
		]);
	});

	it("should check each tracked place's metadata and retain its unreadable file baseline", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = placeCurrent({
			description: "Welcome",
			displayName: "Lobby",
			serverSize: 20,
		});
		const store = fakeStateStore({
			initial: {
				production: { environment: "production", resources: [current], version: 1 },
			},
		});
		const httpClient = createFakeHttpClient().mockResponse({
			body: validPlaceBody({
				description: "Edited welcome",
				displayName: "Edited lobby",
				serverSize: 50,
			}),
			status: 200,
		});
		const result = await previewDiffAsync({
			config: {
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				places: {
					"start-place": {
						description: "Welcome",
						displayName: "Lobby",
						filePath: "places/start.rbxl",
						serverSize: 20,
					},
				},
			},
			environment: "production",
			readFile: async () => new Uint8Array([1, 2, 3]),
			registry: metadataRegistry(httpClient),
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["place", "universe"],
			edits: [
				{
					key: "start-place",
					fields: [
						{ current: "Lobby", field: "displayName", live: "Edited lobby" },
						{ current: "Welcome", field: "description", live: "Edited welcome" },
						{ current: 20, field: "serverSize", live: 50 },
					],
					kind: "place",
				},
			],
			missing: [],
		});
		expect(result.data.drift).toStrictEqual([
			{ key: "start-place", kind: "place", type: "noop" },
		]);
		expect(result.data.ops).toMatchObject([
			{
				changedFields: ["displayName", "description", "serverSize"],
				current: {
					fileHash: current.fileHash,
					filePath: "places/start.rbxl",
					outputs: { versionNumber: 1 },
				},
				type: "update",
			},
		]);
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([["GET", "/cloud/v2/universes/1234567890/places/4711"]]);
		expect(store.writes).toBeEmpty();
	});

	it.for(UNIVERSE_MANAGED_FLAGS)(
		"should report a managed universe %s edit",
		async (field, { expect }) => {
			expect.hasAssertions();

			const fixture = universePreview(
				createFakeHttpClient().mockResponse({
					body: validUniverseBody({ [field]: false }),
					status: 200,
				}),
				universeCurrent({ [field]: true }),
			);
			const result = await previewDiffAsync(fixture.options);
			assert(result.success);

			expect(result.data.liveCheck!.edits).toStrictEqual([
				{ key: "main", fields: [{ current: true, field, live: false }], kind: "universe" },
			]);
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should report a removed managed universe %s",
		async (field, { expect }) => {
			expect.hasAssertions();

			const saved = { title: "Community", uri: "https://example.com/community" };
			const fixture = universePreview(
				createFakeHttpClient().mockResponse({ body: validUniverseBody(), status: 200 }),
				universeCurrent({ [field]: saved }),
			);
			const result = await previewDiffAsync(fixture.options);
			assert(result.success);

			expect(result.data.liveCheck!.edits).toStrictEqual([
				{
					key: "main",
					fields: [{ current: saved, field, live: undefined }],
					kind: "universe",
				},
			]);
		},
	);

	it("should report universe display name, visibility and disabled private servers", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = universePreview(
			createFakeHttpClient().mockResponse({ body: validUniverseBody(), status: 200 }),
			universeCurrent({
				displayName: "Saved title",
				privateServerPriceRobux: 100,
				visibility: "private",
			}),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([
			{
				key: "main",
				fields: [
					{ current: "private", field: "visibility", live: "public" },
					{ current: "Saved title", field: "displayName", live: "Test Universe" },
					{ current: 100, field: "privateServerPriceRobux", live: undefined },
				],
				kind: "universe",
			},
		]);
	});

	it("should ignore unmanaged universe settings", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = universePreview(
			createFakeHttpClient().mockResponse({
				body: validUniverseBody({
					desktopEnabled: false,
					discordSocialLink: { title: "New", uri: "https://example.com" },
					privateServerPriceRobux: 100,
				}),
				status: 200,
			}),
			universeCurrent(),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([]);
		expect(result.data.ops).toStrictEqual([{ key: "main", kind: "universe", type: "noop" }]);
	});

	it("should fail the preview when a tracked universe cannot be read", async ({ expect }) => {
		expect.hasAssertions();

		const cause = new OpenCloudError("read refused");
		const fixture = universePreview(createFakeHttpClient().mockError(cause), universeCurrent());
		const result = await previewDiffAsync(fixture.options);

		expect(result).toStrictEqual({
			err: { cause, kind: "liveCheckFailed", resourceKind: "universe" },
			success: false,
		});
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should report a missing universe and retain its saved baseline", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = universePreview(
			createFakeHttpClient().mockError(new ApiError("Not found", { statusCode: 404 })),
			universeCurrent({ desktopEnabled: true }),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.missing).toStrictEqual([
			{ key: "main", kind: "universe", robloxId: "1234567890" },
		]);
		expect(result.data.ops).toStrictEqual([{ key: "main", kind: "universe", type: "noop" }]);
	});

	it("should retain managed visibility when Roblox cannot classify it", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = universePreview(
			createFakeHttpClient().mockResponse({
				body: validUniverseBody({ visibility: "VISIBILITY_UNSPECIFIED" }),
				status: 200,
			}),
			universeCurrent({ visibility: "private" }),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([]);
		expect(result.data.ops).toStrictEqual([{ key: "main", kind: "universe", type: "noop" }]);
	});

	it("should fail the preview for an API refusal other than a missing universe", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const cause = new ApiError("Forbidden", { statusCode: 403 });
		const fixture = universePreview(createFakeHttpClient().mockError(cause), universeCurrent());

		await expect(previewDiffAsync(fixture.options)).resolves.toStrictEqual({
			err: { cause, kind: "liveCheckFailed", resourceKind: "universe" },
			success: false,
		});
	});

	it("should preview a managed universe setting edit independently of ordinary Drift", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = universeCurrent({ desktopEnabled: true });
		const store = fakeStateStore({
			initial: {
				production: { environment: "production", resources: [current], version: 1 },
			},
		});
		const httpClient = createFakeHttpClient().mockResponse({
			body: validUniverseBody({ desktopEnabled: false }),
			status: 200,
		});
		const result = await previewDiffAsync({
			config: {
				environments: { production: {} },
				universe: { desktopEnabled: true, universeId: "1234567890" },
			},
			environment: "production",
			registry: metadataRegistry(httpClient),
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["place", "universe"],
			edits: [
				{
					key: "main",
					fields: [{ current: true, field: "desktopEnabled", live: false }],
					kind: "universe",
				},
			],
			missing: [],
			skippedKinds: [
				{ kind: "badge", reason: "unsupported" },
				{ kind: "developerProduct", reason: "unsupported" },
				{ kind: "gamePass", reason: "unsupported" },
			],
		});
		expect(result.data.drift).toStrictEqual([{ key: "main", kind: "universe", type: "noop" }]);
		expect(result.data.ops).toMatchObject([
			{
				current: { desktopEnabled: false },
				desired: { desktopEnabled: true },
				type: "update",
			},
		]);
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([["GET", "/cloud/v2/universes/1234567890"]]);
		expect(store.writes).toBeEmpty();
	});
});
