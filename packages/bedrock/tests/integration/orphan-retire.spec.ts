import {
	asResourceKey,
	asRobloxAssetId,
	type BedrockState,
	createDeveloperProductDriver,
	createGamePassDriver,
	createPlaceDriver,
	createUniverseDriver,
	deploy,
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
	validPlaceBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it, vi } from "vitest";

import { REDACTED_ICON_BYTES } from "#src/core/redacted-icon";
import { previewDiffAsync } from "#src/shell/preview-diff";
import {
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";
import { fakeStateLock } from "#tests/helpers/state-lock";
import { fakeStateStore } from "#tests/helpers/state-store";

async function noFilesAsync(): Promise<never> {
	throw new Error("Orphan retirement must not read old artifacts or icons");
}

function formFields(body: FormData): Record<string, Blob | string> {
	const fields: Record<string, Blob | string> = {};
	for (const key of body.keys()) {
		fields[key] = body.get(key)!;
	}

	return fields;
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
		place: createPlaceDriver({ ...dependencies, client: new PlacesClient(options) }),
		universe: createUniverseDriver({
			places: new PlacesClient(options),
			universes: new UniversesClient(options),
		}),
	};
}

const CONFIG = { environments: { production: {} }, orphans: "retire" } as const;

function initial(resources: BedrockState["resources"]): BedrockState {
	return { environment: "production", resources, version: 1 };
}

describe("implicit orphan retirement", () => {
	it.for([deploy, provision, publish])(
		"should refuse saved universe removal before default registry configuration in %s",
		async (command, { expect, onTestFinished }) => {
			expect.hasAssertions();

			const fetch = vi.fn<typeof globalThis.fetch>();
			vi.stubGlobal("fetch", fetch);
			onTestFinished(() => {
				vi.unstubAllGlobals();
			});
			const trace: Array<string> = [];
			const prior = initial([universeCurrent()]);
			const store = fakeStateStore({ initial: { production: prior }, trace });
			const result = await command({
				config: CONFIG,
				credential: { apiKey: "fake", kind: "apiKey" },
				environment: "production",
				readFile: noFilesAsync,
				statePort: store.port,
			});

			expect(result).toStrictEqual({
				err: {
					cause: {
						key: prior.resources[0]!.key,
						kind: "retirementRejected",
						message: "Universe removal is not available at this time.",
					},
					kind: "buildDesiredFailed",
				},
				success: false,
			});
			expect(trace).toStrictEqual(["read:production"]);
			expect(fetch).not.toHaveBeenCalled();
			expect(store.writes).toStrictEqual([]);
			expect(store.states.get("production")).toBe(prior);
		},
	);

	it.for([deploy, provision, publish])(
		"should retain missing registry errors without a saved universe in %s",
		async (command, { expect }) => {
			expect.hasAssertions();

			const store = fakeStateStore({ initial: { production: initial([gamePassCurrent()]) } });
			const lock = fakeStateLock();
			const result = await command({
				config: CONFIG,
				credential: { apiKey: "fake", kind: "apiKey" },
				environment: "production",
				stateLockPort: lock.port,
				statePort: store.port,
			});

			expect(result).toStrictEqual({
				err: {
					hint: "declare universe.universeId in bedrock.config.ts",
					kind: "registryConfigMissing",
					missing: "universeId",
				},
				success: false,
			});
			expect(lock.acquired).toStrictEqual(["production"]);
			expect(lock.released).toStrictEqual(["production"]);
			expect(store.writes).toStrictEqual([]);
		},
	);

	it("should report a failed universe preflight read and release its hold", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const error = {
			file: "production.json",
			kind: "stateError",
			reason: "Invalid JSON",
		} as const;
		const store = fakeStateStore({ refuseRead: { production: error } });
		const lock = fakeStateLock();
		const result = await deploy({
			config: CONFIG,
			credential: { apiKey: "fake", kind: "apiKey" },
			environment: "production",
			stateLockPort: lock.port,
			statePort: store.port,
		});

		expect(result).toStrictEqual({
			err: { cause: error, kind: "stateReadFailed" },
			success: false,
		});
		expect(lock.released).toStrictEqual(["production"]);
		expect(store.writes).toStrictEqual([]);
	});

	it("should refuse an orphan place still adopted by an occupied config key", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const orphan = placeCurrent();
		const adopted = placeCurrent({ key: asResourceKey("adopted") });
		const prior = initial([orphan, adopted, gamePassCurrent()]);
		const store = fakeStateStore({ initial: { production: prior } });
		const http = createFakeHttpClient();
		const result = await provision({
			config: {
				...CONFIG,
				environments: { production: { places: { adopted: { placeId: orphan.placeId } } } },
				passes: { "vip-pass": { retired: "untrack" } },
				places: { adopted: {} },
			},
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: {
					kind: "retirementRejected",
					message:
						"Cannot retire place 'start-place' (4711): it is still adopted by place 'adopted'.",
				},
				kind: "buildDesiredFailed",
			},
			success: false,
		});
		expect(http.requests).toStrictEqual([]);
		expect(store.writes).toStrictEqual([]);
		expect(store.states.get("production")).toBe(prior);
	});

	it("should leave orphan place retirement to the asset stage when publishing", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const place = placeCurrent();
		const prior = { ...initial([place]), pendingRebuild: new Set([place.key]) };
		const store = fakeStateStore({ initial: { production: prior } });
		const http = createFakeHttpClient();

		await expect(
			publish({
				config: CONFIG,
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			}),
		).resolves.toMatchObject({ data: { resources: [place] }, success: true });
		expect(store.states.get("production")).toStrictEqual(prior);
		expect(http.requests).toStrictEqual([]);
	});

	it.for([
		{
			arrange: (http: FakeHttpClient) => {
				return http
					.mockResponse({ status: 204 })
					.mockApiError({ message: "Icon denied", statusCode: 403 });
			},
			current: developerProductCurrent({
				outputs: {
					iconImageAssetId: asRobloxAssetId("111"),
					productId: asRobloxAssetId("8172635495"),
				},
			}),
			methods: ["PATCH", "POST", "PATCH", "POST"],
			retry: (http: FakeHttpClient) => {
				return http.mockResponse({ status: 204 }).mockResponse({ status: 200 });
			},
		},
		{
			arrange: (http: FakeHttpClient) => {
				return http
					.mockResponse({ body: validPlaceBody({ root: false }), status: 200 })
					.mockApiError({ message: "Metadata denied", statusCode: 403 });
			},
			current: placeCurrent(),
			methods: ["GET", "PATCH", "GET", "PATCH"],
			retry: (http: FakeHttpClient) => {
				return http
					.mockResponse({ body: validPlaceBody({ root: false }), status: 200 })
					.mockResponse({ body: validPlaceBody(), status: 200 });
			},
		},
	])(
		"should retain a failed orphan $current.kind and converge on retry",
		async ({ arrange, current, methods, retry }, { expect }) => {
			expect.hasAssertions();

			const store = fakeStateStore({ initial: { production: initial([current]) } });
			const http = arrange(createFakeHttpClient());
			const options = {
				config: CONFIG,
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			};

			await expect(deploy(options)).resolves.toMatchObject({
				err: { kind: "applyFailed" },
				success: false,
			});
			expect(store.states.get("production")!.resources).toStrictEqual([current]);

			retry(http);

			await expect(deploy(options)).resolves.toMatchObject({
				data: { resources: [] },
				success: true,
			});
			expect(store.states.get("production")!.resources).toStrictEqual([]);
			expect(http.requests.map(({ request }) => request.method)).toStrictEqual(methods);
		},
	);

	it.for([{}, { orphans: "error" }] as const)(
		"should retain default orphan refusal for config %j",
		async (policy, { expect }) => {
			expect.hasAssertions();

			const store = fakeStateStore({ initial: { production: initial([gamePassCurrent()]) } });
			const http = createFakeHttpClient();
			const result = await deploy({
				config: { environments: { production: {} }, ...policy },
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toMatchObject({
				err: { cause: { kind: "orphanRejected" }, kind: "buildDesiredFailed" },
				success: false,
			});
			expect(http.requests).toStrictEqual([]);
			expect(store.writes).toStrictEqual([]);
		},
	);

	it("should retire a removed product including its recorded icon and preserve the write fence", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-26T12:34:56.123Z"));
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const current = developerProductCurrent({
			outputs: {
				iconImageAssetId: asRobloxAssetId("111"),
				productId: asRobloxAssetId("8172635495"),
			},
		});
		const store = fakeStateStore({ initial: { production: initial([current]) } });
		const http = createFakeHttpClient()
			.mockResponse({ status: 204 })
			.mockResponse({ status: 200 });
		const result = await provision({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect({ resources: store.states.get("production")!.resources, result }).toMatchObject({
			resources: [],
			result: { data: { resources: [] }, success: true },
		});
		expect(store.writes).toStrictEqual([
			{ environment: "production", expected: { kind: "present", token: "production-1" } },
		]);
		expect(http.requests.map(({ request }) => [request.method, request.url])).toStrictEqual([
			["PATCH", "/developer-products/v2/universes/123/developer-products/8172635495"],
			[
				"POST",
				"/legacy-game-internationalization/v1/developer-products/8172635495/icons/language-codes/en_us",
			],
		]);

		const patch = http.requests[0]!.request.body;
		assert(patch instanceof FormData);

		expect(formFields(patch)).toStrictEqual({
			name: "zzz_DEPRECATED(2026-10-26 12:34:56.123)",
			description: "",
			isForSale: "false",
		});

		const upload = http.requests[1]!.request.body;
		assert(upload instanceof FormData);
		const image = upload.get("Files");
		assert(image instanceof Blob);

		expect(new Uint8Array(await image.arrayBuffer())).toStrictEqual(REDACTED_ICON_BYTES);
	});

	it("should retire an orphan non-root place without reading its old artifact and clear its bookkeeping", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-26T12:34:56.123Z"));
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const place = placeCurrent();
		const prior = {
			...initial([place]),
			pendingRebuild: new Set([place.key]),
			realDisplay: { "place:start-place": { displayName: "Real arena" } },
		};
		const store = fakeStateStore({ initial: { production: prior } });
		const http = createFakeHttpClient()
			.mockResponse({ body: validPlaceBody({ root: false }), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 });
		const result = await provision({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({ data: { resources: [] }, success: true });
		expect(store.states.get("production")).toStrictEqual(initial([]));
		expect(http.requests.map(({ request }) => [request.method, request.url])).toStrictEqual([
			["GET", "/cloud/v2/universes/123/places/4711"],
			[
				"PATCH",
				"/cloud/v2/universes/123/places/4711?updateMask=description,displayName,serverSize",
			],
		]);
		expect(http.requests[1]!.request.body).toStrictEqual({
			description: "",
			displayName: "zzz_DEPRECATED(2026-10-26 12:34:56.123)",
			serverSize: 1,
		});
	});

	it.for([deploy, provision, publish, previewDiffAsync])(
		"should refuse an orphan root before every operation through %s",
		async (command, { expect }) => {
			expect.hasAssertions();

			const place = placeCurrent();
			const prior = initial([
				universeCurrent({ outputs: { rootPlaceId: place.placeId } }),
				place,
				gamePassCurrent(),
			]);
			const store = fakeStateStore({ initial: { production: prior } });
			const http = createFakeHttpClient();
			const result = await command({
				config: {
					...CONFIG,
					products: { fresh: { name: "Fresh", description: "New" } },
					universe: { displayName: "Changed", universeId: "1234567890" },
				},
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toMatchObject({
				err: {
					cause: {
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
			expect(store.states.get("production")).toBe(prior);
		},
	);

	it.for([deploy, provision, publish, previewDiffAsync])(
		"should refuse universe removal under retire before sibling operations through %s",
		async (command, { expect }) => {
			expect.hasAssertions();

			const prior = initial([universeCurrent(), gamePassCurrent()]);
			const store = fakeStateStore({ initial: { production: prior } });
			const http = createFakeHttpClient();
			const result = await command({
				config: {
					...CONFIG,

					passes: { "vip-pass": { retired: "untrack" } },
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
						kind: "retirementRejected",
						message: "Universe removal is not available at this time.",
					},
					kind: "buildDesiredFailed",
				},
				success: false,
			});
			expect(http.requests).toStrictEqual([]);
			expect(store.writes).toStrictEqual([]);
			expect(store.states.get("production")).toBe(prior);
		},
	);

	it("should keep the unknown-root GET backstop and retain its state on refusal", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const place = placeCurrent();
		const store = fakeStateStore({ initial: { production: initial([place]) } });
		const http = createFakeHttpClient().mockResponse({
			body: validPlaceBody({ root: true }),
			status: 200,
		});
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(store.states.get("production")!.resources).toStrictEqual([place]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["GET"]);
	});

	it.for([{}, { movedFrom: "start-place" }])(
		"should preserve implicit and explicit place identity before provision filtering with %j",
		async (rename, { expect }) => {
			expect.hasAssertions();

			const place = placeCurrent();
			const product = developerProductCurrent();
			const pass = gamePassCurrent();
			const prior = {
				...initial([place, product, pass]),
				pendingRebuild: new Set([place.key]),
				realDisplay: { "place:start-place": { displayName: "Real name" } },
			};
			const store = fakeStateStore({ initial: { production: prior } });
			const http = createFakeHttpClient();
			const result = await provision({
				config: {
					...CONFIG,
					environments: { production: { places: { arena: { placeId: place.placeId } } } },
					passes: { "vip-pass": { retired: "untrack" } },
					places: {
						arena: { filePath: "places/start.rbxl", ...rename },
					},
					products: {
						gems: {
							name: product.name,
							description: product.description,
							movedFrom: "gem-pack",
						},
					},
				},
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toMatchObject({
				data: {
					resources: [
						{ ...place, key: "arena" },
						{ ...product, key: "gems" },
					],
				},
				success: true,
			});
			expect(store.states.get("production")!.pendingRebuild).toStrictEqual(
				new Set([asResourceKey("arena")]),
			);
			expect(store.states.get("production")!.realDisplay).toStrictEqual({
				"place:arena": { displayName: "Real name" },
			});
			expect(http.requests).toStrictEqual([]);
		},
	);

	it("should retire no resources without state and avoid replaying a successful retirement", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ status: 204 })
			.mockResponse({ status: 200 });
		const store = fakeStateStore({ initial: { production: initial([gamePassCurrent()]) } });
		const options = {
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		};

		await expect(deploy(options)).resolves.toMatchObject({
			data: { resources: [] },
			success: true,
		});
		await expect(deploy(options)).resolves.toMatchObject({
			data: { resources: [] },
			success: true,
		});

		const absent = fakeStateStore();

		await expect(provision({ ...options, statePort: absent.port })).resolves.toMatchObject({
			data: { resources: [] },
			success: true,
		});
		expect(absent.writes).toStrictEqual([
			{ environment: "production", expected: { kind: "absent" } },
		]);
		expect(http.requests).toHaveLength(2);
	});

	it("should retain a partially failed orphan and retry while dropping successful siblings", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const pass = gamePassCurrent();
		const product = developerProductCurrent();
		const store = fakeStateStore({ initial: { production: initial([pass, product]) } });
		const http = createFakeHttpClient()
			.mockResponse({ status: 204 })
			.mockResponse({ status: 204 })
			.mockApiError({ message: "Icon denied", statusCode: 403 });
		const options = {
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		};

		await expect(deploy(options)).resolves.toMatchObject({
			err: { kind: "applyFailed" },
			success: false,
		});
		expect(store.states.get("production")!.resources).toStrictEqual([pass]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
			"PATCH",
			"PATCH",
			"POST",
		]);

		http.mockResponse({ status: 204 }).mockResponse({ status: 200 });

		await expect(deploy(options)).resolves.toMatchObject({
			data: { resources: [] },
			success: true,
		});
		expect({
			methods: http.requests.map(({ request }) => request.method),
			resources: store.states.get("production")!.resources,
		}).toStrictEqual({ methods: ["PATCH", "PATCH", "POST", "PATCH", "POST"], resources: [] });
	});

	it("should keep an orphan pass sharing an owed place key out of publication", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const place = placeCurrent();
		const pass = gamePassCurrent({ key: place.key });
		const prior = { ...initial([pass, place]), pendingRebuild: new Set([place.key]) };
		const store = fakeStateStore({ initial: { production: prior } });
		const http = createFakeHttpClient();
		const reads: Array<string> = [];
		const result = await publish({
			config: {
				...CONFIG,
				environments: {
					production: { places: { "start-place": { placeId: place.placeId } } },
				},
				places: { "start-place": { filePath: "places/start.rbxl" } },
			},
			environment: "production",
			readFile: async (path) => {
				reads.push(path);
				return new Uint8Array([1, 2, 3]);
			},
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({ data: { resources: [pass, place] }, success: true });
		expect(store.states.get("production")!.resources).toStrictEqual([pass, place]);
		expect(reads).toStrictEqual([place.filePath]);
		expect(http.requests).toStrictEqual([]);
	});

	it("should preview current-bearing retirements without reading orphan artifacts or writing state", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const resources = [gamePassCurrent(), developerProductCurrent(), placeCurrent()];
		const store = fakeStateStore({ initial: { production: initial(resources) } });
		const result = await previewDiffAsync({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			statePort: store.port,
		});

		expect(result).toMatchObject({
			data: {
				declarationReports: [],
				ops: resources.map((current) => {
					return { key: current.key, current, type: "retire" };
				}),
			},
			success: true,
		});
		expect(store.writes).toStrictEqual([]);
	});

	it.for([deploy, provision])(
		"should retire a removed pass through %s and persist its successful drop",
		async (command, { expect, onTestFinished }) => {
			expect.hasAssertions();

			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-10-26T12:34:56.123Z"));
			onTestFinished(() => {
				vi.useRealTimers();
			});
			const current = gamePassCurrent();
			const store = fakeStateStore({ initial: { production: initial([current]) } });
			const http = createFakeHttpClient()
				.mockResponse({ status: 204 })
				.mockResponse({ status: 200 });
			const result = await command({
				config: CONFIG,
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toMatchObject({ data: { resources: [] }, success: true });
			expect(store.states.get("production")!.resources).toStrictEqual([]);
			expect(store.writes).toHaveLength(1);
			expect(http.requests.map(({ request }) => [request.method, request.url])).toStrictEqual(
				[
					["PATCH", "/game-passes/v1/universes/123/game-passes/9876543210"],
					[
						"POST",
						"/legacy-game-internationalization/v1/game-passes/9876543210/icons/language-codes/en_us",
					],
				],
			);

			const { body } = http.requests[0]!.request;
			assert(body instanceof FormData);

			expect(formFields(body)).toStrictEqual({
				name: "zzz_DEPRECATED(2026-10-26 12:34:56.123)",
				description: "",
				isForSale: "false",
			});
		},
	);
});
