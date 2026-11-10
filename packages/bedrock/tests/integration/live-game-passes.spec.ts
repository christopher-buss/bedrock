import { asRobloxAssetId, createGamePassDriver } from "@bedrock-rbx/core";
import { OpenCloudError } from "@bedrock-rbx/ocale";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { createFakeHttpClient, validGamePassBody } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it, vi } from "vitest";

import { previewDiffAsync } from "#src/shell/preview-diff";
import { environmentFrom } from "#tests/helpers/environment";
import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

function livePreview(httpClient = createFakeHttpClient()) {
	const current = gamePassCurrent();
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources: [current], version: 1 } },
	});
	return {
		current,
		httpClient,
		options: {
			config: {
				environments: { production: {} },
				passes: {
					"vip-pass": {
						name: current.name,
						description: current.description,
						icon: current.icon,
						price: 500,
					},
				},
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			registry: {
				gamePass: createGamePassDriver({
					client: new GamePassesClient({
						credential: { apiKey: "fake", kind: "apiKey" },
						httpClient,
						sleep: async () => {},
					}),
					readFile: async () => new Uint8Array(),
					universeId: asRobloxAssetId("123"),
				}),
			},
			statePort: store.port,
		},
		store,
	};
}

describe("game-pass live check", () => {
	it.for([
		{ initial: {} },
		{ initial: { production: { environment: "production", resources: [], version: 1 } } },
	] satisfies ReadonlyArray<Parameters<typeof fakeStateStore>[0]>)(
		"should preview creates without a universe declaration in an empty authenticated environment (%j)",
		async (options, { expect }) => {
			expect.hasAssertions();

			const store = fakeStateStore(options);
			const result = await previewDiffAsync({
				config: {
					environments: { production: { places: { lobby: { placeId: "4711" } } } },
					places: { lobby: { filePath: "lobby.rbxl" } },
				},
				environment: "production",
				getEnv: environmentFrom({ BEDROCK_API_KEY: "fake" }),
				readFile: async () => new Uint8Array(),
				statePort: store.port,
			});
			assert(result.success, JSON.stringify(result));

			expect(result.data.ops).toMatchObject([
				{ desired: { key: "lobby", kind: "place" }, type: "create" },
			]);
			expect(result.data.liveCheck!.edits).toStrictEqual([]);
			expect(store.writes).toBeEmpty();
		},
	);

	it("should preserve the capacity preview when free badge quota is unknown and deferral is allowed", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const result = await previewDiffAsync({
			config: {
				badges: {
					first: { name: "First", description: "Win", icon: { "en-us": "first.png" } },
				},
				environments: { production: { allowDeferredCreates: true } },
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			registry: {},
			statePort: fakeStateStore().port,
		});
		assert(result.success);

		expect(result.data.deferredCreates).toStrictEqual([]);
		expect(result.data.ops).toMatchObject([{ desired: { kind: "badge" }, type: "create" }]);
	});

	it("should respect an explicit unauthenticated credential without reading environment credentials", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const result = await previewDiffAsync({
			config: { environments: { production: {} } },
			credential: { kind: "none" },
			environment: "production",
			getEnv: () => {
				throw new Error("must not read credentials");
			},
			statePort: fakeStateStore().port,
		});
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: [],
			skippedKinds: [
				{ kind: "badge", reason: "noCredential" },
				{ kind: "developerProduct", reason: "noCredential" },
				{ kind: "gamePass", reason: "noCredential" },
				{ kind: "place", reason: "noCredential" },
				{ kind: "universe", reason: "noCredential" },
			],
		});
	});

	it("should report a Driver without list as unsupported", async ({ expect }) => {
		expect.hasAssertions();

		const result = await previewDiffAsync({
			config: { environments: { production: {} } },
			environment: "production",
			registry: {},
			statePort: fakeStateStore().port,
		});
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: [],
			skippedKinds: [
				{ kind: "badge", reason: "unsupported" },
				{ kind: "developerProduct", reason: "unsupported" },
				{ kind: "gamePass", reason: "unsupported" },
				{ kind: "place", reason: "unsupported" },
				{ kind: "universe", reason: "unsupported" },
			],
		});
	});

	it("should refuse a default live check without an owning universe", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = livePreview();
		const result = await previewDiffAsync({
			...fixture.options,
			credential: { apiKey: "explicit", kind: "apiKey" },
			getEnv: () => {
				throw new Error("must not read credentials");
			},
			registry: undefined,
		});

		expect(result).toMatchObject({
			err: { kind: "registryConfigMissing", missing: "universeId" },
			success: false,
		});
	});

	it.for([
		{
			isForSale: false,
			label: "off-sale",
			priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
		},
		// eslint-disable-next-line unicorn/no-null -- Unset pricing is null on the wire.
		{ isForSale: true, label: "unset pricing", priceInformation: null },
	] as const)(
		"should report $label as an explicit live price value",
		async ({ isForSale, priceInformation }, { expect }) => {
			expect.hasAssertions();

			const current = gamePassCurrent();
			const fixture = livePreview(
				createFakeHttpClient().mockResponse({
					body: {
						gamePasses: [
							{
								...validGamePassBody({
									name: current.name,
									description: current.description,
									gamePassId: 9_876_543_210,
									isForSale,
								}),
								priceInformation,
							},
						],
						// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
						nextPageToken: null,
					},
					status: 200,
				}),
			);
			const result = await previewDiffAsync(fixture.options);
			assert(result.success);

			expect(result.data.liveCheck!.edits).toMatchObject([
				{ fields: [{ current: 500, field: "price", live: undefined }] },
			]);
			expect(result.data.ops).toMatchObject([
				{ current: { price: undefined }, desired: { price: 500 }, type: "update" },
			]);
		},
	);

	it("should use Live as the plan baseline when a config change already matches Roblox", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = gamePassCurrent();
		const fixture = livePreview(
			createFakeHttpClient().mockResponse({
				body: {
					gamePasses: [
						validGamePassBody({
							name: current.name,
							description: current.description,
							gamePassId: 9_876_543_210,
							priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] },
						}),
					], // eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
					nextPageToken: null,
				},
				status: 200,
			}),
		);
		const result = await previewDiffAsync({
			...fixture.options,
			config: {
				...fixture.options.config,
				passes: {
					"vip-pass": { ...fixture.options.config.passes["vip-pass"], price: 120 },
				},
			},
		});
		assert(result.success);

		expect(result.data.drift).toMatchObject([{ changedFields: ["price"], type: "update" }]);
		expect(result.data.ops).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", type: "noop" },
		]);
		expect(result.data.liveCheck!.edits).toMatchObject([
			{ fields: [{ current: 500, field: "price", live: 120 }] },
		]);
	});

	it("should return a live-check failure without writing when a later page cannot be read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const cause = new OpenCloudError("read refused");
		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({ body: { gamePasses: [], nextPageToken: "next" }, status: 200 })
				.mockError(cause),
		);
		const result = await previewDiffAsync(fixture.options);

		expect(result).toStrictEqual({
			err: { cause, kind: "liveCheckFailed", resourceKind: "gamePass" },
			success: false,
		});
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should finish pagination before reporting a tracked pass missing and leave unchanged passes alone", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = gamePassCurrent();
		const httpClient = createFakeHttpClient()
			.mockResponse({
				body: { gamePasses: [validGamePassBody()], nextPageToken: "next" },
				status: 200,
			})
			.mockResponse({
				body: {
					gamePasses: [
						validGamePassBody({
							name: current.name,
							description: current.description,
							gamePassId: 9_876_543_210,
							iconAssetId: 1_122_334_455,
							priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
						}),
					],
					// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
					nextPageToken: null,
				},
				status: 200,
			});
		const fixture = livePreview(httpClient);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["gamePass"],
			edits: [],
			missing: [],
		});
		expect(result.data.ops).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", type: "noop" },
		]);
		expect(
			httpClient.requests.map(({ request }) => {
				return {
					method: request.method,
					url: request.url,
				};
			}),
		).toStrictEqual([
			{ method: "GET", url: "/game-passes/v1/universes/123/game-passes/creator" },
			{
				method: "GET",
				url: "/game-passes/v1/universes/123/game-passes/creator?pageToken=next",
			},
		]);
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should stop at an empty game-pass page token without fetching another page", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({ body: { gamePasses: [], nextPageToken: "" }, status: 200 })
				.mockResponse({ status: 500 }),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success, JSON.stringify(result));

		expect(result.data.liveCheck!.missing).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", robloxId: "9876543210" },
		]);
		expect(fixture.httpClient.requests).toHaveLength(1);
		expect(fixture.httpClient.requests[0]!.request.method).toBe("GET");
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should automatically read game passes with the available Open Cloud credential", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview();
		const bodies = new Map<string, object>([
			[
				"https://apis.roblox.com/developer-products/v2/universes/123/developer-products/creator",
				{ developerProducts: [] },
			],
			[
				"https://apis.roblox.com/game-passes/v1/universes/123/game-passes/creator",
				{ gamePasses: [] },
			],
			["https://badges.roblox.com/v1/universes/123/badges?limit=100", { data: [] }],
		]);
		const fetch = vi.fn<(url: string) => Promise<Response>>(async (url) => {
			return new Response(JSON.stringify(bodies.get(url)), {
				status: 200,
			});
		});
		vi.stubGlobal("fetch", fetch);
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});
		const result = await previewDiffAsync({
			...fixture.options,
			config: { ...fixture.options.config, universe: { universeId: "123" } },
			getEnv: environmentFrom({ BEDROCK_API_KEY: "fake" }),
			registry: undefined,
		});
		assert(result.success);

		expect(fetch).toHaveBeenCalledWith(
			"https://apis.roblox.com/game-passes/v1/universes/123/game-passes/creator",
			expect.objectContaining({ method: "GET" }),
		);
		expect(fetch).toHaveBeenCalledWith(
			"https://badges.roblox.com/v1/universes/123/badges?limit=100",
			expect.objectContaining({ method: "GET" }),
		);
		expect(fetch).toHaveBeenCalledWith(
			"https://apis.roblox.com/developer-products/v2/universes/123/developer-products/creator",
			expect.objectContaining({ method: "GET" }),
		);
		expect(fetch).toHaveBeenCalledTimes(3);
		expect({
			checkedKinds: result.data.liveCheck!.checkedKinds,
			writes: fixture.store.writes,
		}).toStrictEqual({
			checkedKinds: ["badge", "developerProduct", "gamePass"],
			writes: [],
		});
	});

	it("should report a tracked pass missing from Roblox and name checked and skipped kinds", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient().mockResponse({
				body: {
					gamePasses: [], // eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
					nextPageToken: null,
				},
				status: 200,
			}),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck).toStrictEqual({
			checkedKinds: ["gamePass"],
			edits: [],
			missing: [{ key: "vip-pass", kind: "gamePass", robloxId: "9876543210" }],
			skippedKinds: [
				{ kind: "badge", reason: "unsupported" },
				{ kind: "developerProduct", reason: "unsupported" },
				{ kind: "place", reason: "unsupported" },
				{ kind: "universe", reason: "unsupported" },
			],
		});
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should report all skipped kinds when no credential is available", async ({ expect }) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		const result = await previewDiffAsync({
			config: { environments: { production: {} } },
			environment: "production",
			getEnv: () => {},
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.liveCheck).toStrictEqual({
			checkedKinds: [],
			edits: [],
			missing: [],
			skippedKinds: [
				{ kind: "badge", reason: "noCredential" },
				{ kind: "developerProduct", reason: "noCredential" },
				{ kind: "gamePass", reason: "noCredential" },
				{ kind: "place", reason: "noCredential" },
				{ kind: "universe", reason: "noCredential" },
			],
		});
		expect(store.writes).toBeEmpty();
	});

	it("should preview a live price edit separately from config drift without writing", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = gamePassCurrent();
		const httpClient = createFakeHttpClient().mockResponse({
			body: {
				gamePasses: [
					validGamePassBody({
						name: current.name,
						description: current.description,
						gamePassId: 9_876_543_210,
						priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] },
					}),
				],
				// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
				nextPageToken: null,
			},
			status: 200,
		});
		const store = fakeStateStore({
			initial: {
				production: { environment: "production", resources: [current], version: 1 },
			},
		});
		const result = await previewDiffAsync({
			config: {
				environments: { production: {} },
				passes: {
					"vip-pass": {
						name: current.name,
						description: "New description.",
						icon: current.icon,
						price: 500,
					},
				},
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			registry: {
				gamePass: createGamePassDriver({
					client: new GamePassesClient({
						credential: { apiKey: "fake", kind: "apiKey" },
						httpClient,
						sleep: async () => {},
					}),
					readFile: async () => new Uint8Array(),
					universeId: asRobloxAssetId("123"),
				}),
			},
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data.liveCheck!.edits).toStrictEqual([
			{
				key: "vip-pass",
				fields: [{ current: 500, field: "price", live: 120 }],
				kind: "gamePass",
			},
		]);
		expect(result.data.drift).toMatchObject([
			{ changedFields: ["description"], type: "update" },
		]);
		expect(result.data.ops).toMatchObject([
			{
				changedFields: ["description", "price"],
				current: { price: 120 },
				desired: { price: 500 },
				type: "update",
			},
		]);
		expect(
			httpClient.requests.map(({ request }) => {
				return {
					method: request.method,
					url: request.url,
				};
			}),
		).toStrictEqual([
			{ method: "GET", url: "/game-passes/v1/universes/123/game-passes/creator" },
		]);
		expect(store.writes).toBeEmpty();
	});
});
