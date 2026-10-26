import {
	asResourceKey,
	asRobloxAssetId,
	type BedrockState,
	buildDesired,
	createDeveloperProductDriver,
	createGamePassDriver,
	createPlaceDriver,
	createUniverseDriver,
	deploy,
	diff,
	type DriverRegistry,
	provision,
	publish,
} from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validDeveloperProductBody,
	validPlaceBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";
import { fromAny } from "@total-typescript/shoehorn";

import { assert, describe, it, vi } from "vitest";

import { previewDiffAsync } from "#src/shell/preview-diff";
import { gamePassCurrent, placeCurrent, universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const CURRENT = placeCurrent({
	description: "Play here",
	displayName: "Old arena",
	serverSize: 30,
});
const CONFIG = {
	environments: { production: {} },
	places: { "start-place": { retired: true } },
} as const;

async function noFilesAsync(): Promise<Uint8Array> {
	throw new Error("Retirement must not read artifacts");
}

function registry(httpClient: FakeHttpClient): DriverRegistry {
	const options = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		httpClient,
		sleep: async () => {},
	};
	const dependencies = { readFile: noFilesAsync, universeId: asRobloxAssetId("123") };
	return {
		developerProduct: createDeveloperProductDriver({
			...dependencies,
			client: new DeveloperProductsClient(options),
		}),
		gamePass: createGamePassDriver({ ...dependencies, client: new GamePassesClient(options) }),
		place: createPlaceDriver({
			...dependencies,
			client: new PlacesClient(options),
		}),
		universe: createUniverseDriver({
			places: new PlacesClient(options),
			universes: new UniversesClient(options),
		}),
	};
}

function initialState(): BedrockState {
	return {
		environment: "production",
		pendingRebuild: new Set([CURRENT.key]),
		realDisplay: {
			"place:start-place": { description: "Real description", displayName: "Real arena" },
		},
		resources: [CURRENT],
		version: 1,
	};
}

const FAILURES = [
	{
		arrange: (http: FakeHttpClient) => {
			return http.mockApiError({ message: "Retire rejected", statusCode: 403 });
		},
		failure: "read",
		methods: ["GET"],
	},
	{
		arrange: (http: FakeHttpClient) => {
			return http
				.mockResponse({ body: validPlaceBody({ root: false }), status: 200 })
				.mockApiError({ message: "Retire rejected", statusCode: 409 });
		},
		failure: "patch",
		methods: ["GET", "PATCH"],
	},
	{
		arrange: (http: FakeHttpClient) => http.mockResponse({ body: { root: true }, status: 200 }),
		failure: "malformed",
		methods: ["GET"],
	},
];

describe("place retirement", () => {
	it("should retain the universe refusal for untyped inputs before any stage filter", async ({
		expect,
	}) => {
		expect.assertions(1);

		const resources: Parameters<typeof buildDesired>[0]["resources"] = fromAny([
			{ key: universeCurrent().key, kind: "universe", retired: true },
		]);

		await expect(
			buildDesired({ include: () => false, readFile: noFilesAsync, resources }),
		).resolves.toMatchObject({
			err: {
				key: universeCurrent().key,
				kind: "retirementRejected",
				message: "Universe removal is not available at this time.",
			},
			success: false,
		});
	});

	it("should drop only a successful place retirement when a sibling retirement fails", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const failed = placeCurrent({
			key: asResourceKey("failed"),
			placeId: asRobloxAssetId("999"),
		});
		const initial = {
			...initialState(),
			pendingRebuild: new Set([CURRENT.key, failed.key]),
			realDisplay: {
				...initialState().realDisplay,
				"place:failed": { displayName: "Keep me" },
			},
			resources: [CURRENT, failed],
		};
		const store = fakeStateStore({ initial: { production: initial } });
		const http = createFakeHttpClient()
			.mockResponse({ body: validPlaceBody({ root: false }), status: 200 })
			.mockApiError({ message: "Forbidden", statusCode: 403 })
			.mockResponse({ body: validPlaceBody(), status: 200 });
		const result = await deploy({
			config: { ...CONFIG, places: { ...CONFIG.places, failed: { retired: true } } },
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: { failures: [{ key: "failed", kind: "driverFailure" }] },
				kind: "applyFailed",
			},
			success: false,
		});
		expect(store.states.get("production")).toStrictEqual({
			environment: "production",
			pendingRebuild: new Set([failed.key]),
			realDisplay: { "place:failed": { displayName: "Keep me" } },
			resources: [failed],
			version: 1,
		});
		expect(http.requests.map(({ request }) => [request.method, request.url])).toStrictEqual([
			["GET", "/cloud/v2/universes/123/places/4711"],
			["GET", "/cloud/v2/universes/123/places/999"],
			[
				"PATCH",
				"/cloud/v2/universes/123/places/4711?updateMask=description,displayName,serverSize",
			],
		]);
	});

	it("should allow a managed non-root retire and an absent marker while leaving root untrack explicit", ({
		expect,
	}) => {
		expect.assertions(1);

		const universe = universeCurrent({ outputs: { rootPlaceId: asRobloxAssetId("999") } });
		const root = placeCurrent({ key: asResourceKey("root"), placeId: asRobloxAssetId("999") });

		expect(
			diff(
				[
					{ key: CURRENT.key, kind: "place", retired: true },
					{ key: asResourceKey("absent"), kind: "place", retired: true },
					{ key: root.key, kind: "place", retired: "untrack" },
				],
				[universe, CURRENT, root],
			),
		).toStrictEqual([
			{ key: CURRENT.key, current: CURRENT, type: "retire" },
			{ key: "absent", kind: "place", type: "noop" },
			{ key: root.key, current: root, type: "untrack" },
		]);
	});

	it.for([{}, { movedFrom: "previous" }])(
		"should retire one place while preserving a sibling rename with movedFrom %s",
		async (rename, { expect }) => {
			expect.hasAssertions();

			const sibling = placeCurrent({
				key: asResourceKey("previous"),
				placeId: asRobloxAssetId("999"),
			});
			const initial = {
				...initialState(),
				pendingRebuild: new Set([CURRENT.key, sibling.key]),
				realDisplay: {
					...initialState().realDisplay,
					"place:previous": { displayName: "Real sibling" },
				},
				resources: [CURRENT, sibling],
			};
			const store = fakeStateStore({ initial: { production: initial } });
			const http = createFakeHttpClient()
				.mockResponse({ body: validPlaceBody({ root: false }), status: 200 })
				.mockResponse({ body: validPlaceBody(), status: 200 });
			const result = await provision({
				config: {
					...CONFIG,
					environments: { production: { places: { renamed: { placeId: "999" } } } },
					places: {
						...CONFIG.places,
						renamed: {
							filePath: "missing.rbxl",
							...rename,
						},
					},
				},
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toStrictEqual({
				data: {
					environment: "production",
					pendingRebuild: new Set(["renamed"]),
					realDisplay: { "place:renamed": { displayName: "Real sibling" } },
					resources: [{ ...sibling, key: "renamed" }],
					version: 1,
				},
				success: true,
			});
			expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
				"PATCH",
			]);
		},
	);

	it("should retain a failed retirement checkpoint during provision", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockApiError({ message: "Forbidden", statusCode: 403 });
		const initial = initialState();
		const store = fakeStateStore({ initial: { production: initial } });
		const result = await provision({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(store.states.get("production")).toStrictEqual(initial);
	});

	it.for(FAILURES)(
		"should retain failed $failure retirement metadata and pending rebuild, then converge on retry",
		async ({ arrange, methods }, { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient();
			arrange(http);

			const initial = initialState();
			const store = fakeStateStore({ initial: { production: initial } });
			const options = {
				config: CONFIG,
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			};
			const result = await deploy(options);

			expect(result).toMatchObject({
				err: {
					cause: { failures: [{ key: CURRENT.key, kind: "driverFailure" }] },
					kind: "applyFailed",
				},
				success: false,
			});
			expect([
				store.states.get("production"),
				http.requests.map(({ request }) => request.method),
			]).toStrictEqual([initial, methods]);

			const beforeRetry = http.requests.length;
			http.mockResponse({
				body: validPlaceBody({
					description: "",
					displayName: "zzz_DEPRECATED(2026-10-25 00:00:00)",
					root: false,
					serverSize: 1,
				}),
				status: 200,
			}).mockResponse({ body: validPlaceBody(), status: 200 });
			const retry = await deploy(options);

			expect([
				retry,
				http.requests.slice(beforeRetry).map(({ request }) => request.method),
			]).toStrictEqual([
				{
					data: { environment: "production", resources: [], version: 1 },
					success: true,
				},
				["GET", "PATCH"],
			]);

			const afterRetry = http.requests.length;

			await expect(deploy(options)).resolves.toStrictEqual(retry);
			expect(http.requests).toHaveLength(afterRetry);
		},
	);

	it("should preserve the recovery snapshot and fence if the final state write fails", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: validPlaceBody({ root: false }), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 });
		const initial = initialState();
		const store = fakeStateStore({
			initial: { production: initial },
			refuseWrite: {
				production: { file: "production.json", kind: "stateConflict", reason: "Moved" },
			},
		});
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				kind: "stateWriteFailed",
				unsavedState: { environment: "production", resources: [], version: 1 },
			},
			success: false,
		});
		expect(store.states.get("production")).toBe(initial);
		expect(store.writes).toStrictEqual([
			{ environment: "production", expected: { kind: "present", token: "production-1" } },
		]);
	});

	it.for([{}, { movedFrom: "start-place" }])(
		"should refuse retiring a place another declared artifact still adopts with movedFrom %s before provision writes anything",
		async (rename, { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient();
			const initial = initialState();
			const store = fakeStateStore({ initial: { production: initial } });
			const result = await provision({
				config: {
					...CONFIG,
					environments: { production: { places: { adopted: { placeId: "4711" } } } },
					places: {
						...CONFIG.places,
						adopted: {
							filePath: "missing.rbxl",
							...rename,
						},
					},
				},
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toMatchObject({
				err: {
					cause: {
						key: CURRENT.key,
						kind: "retirementRejected",
						message:
							"Cannot retire place 'start-place' (4711): it is still adopted by place 'adopted'.",
					},
					kind: "buildDesiredFailed",
				},
				success: false,
			});
			expect(store.writes).toStrictEqual([]);
			expect(http.requests).toStrictEqual([]);
		},
	);

	it.for([deploy, provision, publish, previewDiffAsync])(
		"should refuse a managed root before any operation in %s",
		async (run, { expect }) => {
			expect.hasAssertions();

			const initial = {
				...initialState(),
				resources: [
					universeCurrent({ outputs: { rootPlaceId: CURRENT.placeId } }),
					placeCurrent({ key: asResourceKey("other"), placeId: asRobloxAssetId("999") }),
					CURRENT,
				],
			};
			const store = fakeStateStore({ initial: { production: initial } });
			const http = createFakeHttpClient();
			const result = await run({
				config: {
					...CONFIG,
					products: { fresh: { name: "Fresh", description: "New" } },
					universe: { displayName: "Changed universe", universeId: "1234567890" },
				},
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toMatchObject({
				err: {
					cause: {
						key: CURRENT.key,
						kind: "retirementRejected",
						message:
							"Cannot retire root place 'start-place' (4711): Roblox derives the experience name and description from it.",
					},
					kind: "buildDesiredFailed",
				},
				success: false,
			});
			expect(http.requests).toStrictEqual([]);
			expect(store.writes).toStrictEqual([]);
			expect(store.states.get("production")).toBe(initial);
		},
	);

	it("should reject managed-root retirement through public diff", ({ expect }) => {
		expect.assertions(1);
		expect(() => {
			return diff(
				[{ key: CURRENT.key, kind: "place", retired: true }],
				[
					gamePassCurrent({ key: CURRENT.key }),
					universeCurrent({ outputs: { rootPlaceId: CURRENT.placeId } }),
					CURRENT,
				],
			);
		}).toThrow(
			"Cannot retire root place 'start-place' (4711): Roblox derives the experience name and description from it.",
		);
	});

	it("should match retirement protection by kind as well as key", ({ expect }) => {
		expect.assertions(1);

		const pass = gamePassCurrent({ key: CURRENT.key });

		expect(
			diff(
				[{ key: pass.key, kind: "gamePass", retired: true }],
				[pass, CURRENT, universeCurrent({ outputs: { rootPlaceId: CURRENT.placeId } })],
			),
		).toStrictEqual([{ key: pass.key, current: pass, type: "retire" }]);
	});

	it("should leave an absent retirement marker harmless beside a managed root place", ({
		expect,
	}) => {
		expect.assertions(1);
		expect(
			diff(
				[{ key: asResourceKey("absent"), kind: "place", retired: true }],
				[universeCurrent({ outputs: { rootPlaceId: CURRENT.placeId } }), CURRENT],
			),
		).toStrictEqual([{ key: "absent", kind: "place", type: "noop" }]);
	});

	it("should fail an unmanaged root retirement before writing the place and continue unrelated operations", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({
				body: validDeveloperProductBody(),
				status: 200,
			})
			.mockResponse({
				body: validPlaceBody({ root: true }),
				status: 200,
			});
		const sibling = placeCurrent({
			key: asResourceKey("sibling"),
			placeId: asRobloxAssetId("999"),
		});
		const initial = { ...initialState(), resources: [CURRENT, sibling] };
		const store = fakeStateStore({ initial: { production: initial } });
		const result = await deploy({
			config: {
				...CONFIG,
				places: { ...CONFIG.places, sibling: { retired: "untrack" } },
				products: { fresh: { name: "Fresh", description: "New" } },
			},
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: {
					failures: [
						{
							key: CURRENT.key,
							cause: {
								message:
									"Cannot retire root place 'start-place' (4711): Roblox derives the experience name and description from it.",
							},
							kind: "driverFailure",
						},
					],
				},
				kind: "applyFailed",
			},
			success: false,
		});
		expect(http.requests.map(({ request }) => [request.method, request.url])).toStrictEqual([
			["POST", "/developer-products/v2/universes/123/developer-products"],
			["GET", "/cloud/v2/universes/123/places/4711"],
		]);
		expect(store.states.get("production")).toStrictEqual({
			...initial,
			resources: [
				CURRENT,
				{
					key: "fresh",
					name: "Fresh",
					description: "New",
					isManagedPricingEnabled: false,
					kind: "developerProduct",
					outputs: { iconImageAssetId: "67890", productId: "12345" },
					price: undefined,
				},
			],
		});
	});

	it.for([
		{ name: "zzz_DEPRECATED(2026-10-26 12:34:56.123)", time: "2026-10-26T12:34:56.123Z" },
		{ name: "zzz_DEPRECATED(2026-10-26 12:34:56)", time: "2026-10-26T12:34:56.000Z" },
	])(
		"should retire a non-root place using metadata only at %s and drop its saved bookkeeping",
		async ({ name, time }, { expect, onTestFinished }) => {
			expect.hasAssertions();

			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date(time));
			onTestFinished(() => {
				vi.useRealTimers();
			});
			const http = createFakeHttpClient()
				.mockResponse({ body: validPlaceBody({ root: false }), status: 200 })
				.mockResponse({ body: validPlaceBody(), status: 200 });
			const store = fakeStateStore({ initial: { production: initialState() } });
			const result = await deploy({
				config: CONFIG,
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});
			assert(result.success);

			expect(result.data).toStrictEqual({
				environment: "production",
				resources: [],
				version: 1,
			});
			expect(store.states.get("production")).toStrictEqual(result.data);
			expect(store.writes).toStrictEqual([
				{ environment: "production", expected: { kind: "present", token: "production-1" } },
			]);
			expect(
				http.requests.map(({ request }) => [request.method, request.url, request.body]),
			).toStrictEqual([
				["GET", "/cloud/v2/universes/123/places/4711", undefined],
				[
					"PATCH",
					"/cloud/v2/universes/123/places/4711?updateMask=description,displayName,serverSize",
					{
						description: "",
						displayName: name,
						serverSize: 1,
					},
				],
			]);
		},
	);
});
