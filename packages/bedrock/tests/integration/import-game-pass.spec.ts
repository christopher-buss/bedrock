import { asResourceKey, asRobloxAssetId, createGamePassDriver, deploy } from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validDeveloperProductBody,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { createDeveloperProductDriver } from "#src/adapters/developer-product-driver";
import type { EnvironmentEntry } from "#src/core/schema";
import type { BedrockState, StateError } from "#src/core/state";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import type { StatePort } from "#src/ports/state-port";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

type PassOverlay = NonNullable<EnvironmentEntry["passes"]>[string];

const PASS_ID = "9876543210";
const EMPTY_FILE_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const LINE = `environments.production.passes.vip-pass.importId "${PASS_ID}"`;

function passBody(price = 500) {
	return validGamePassBody({
		name: "VIP Pass",
		description: "Grants VIP perks.",
		gamePassId: Number(PASS_ID),
		iconAssetId: 1_122_334_455,
		priceInformation: { defaultPriceInRobux: price, enabledFeatures: [] },
	});
}

function listBody(price = 500) {
	// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
	return { gamePasses: [passBody(price)], nextPageToken: null };
}

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

function registryFor(http: FakeHttpClient): DriverRegistry {
	const client = {
		credential: { apiKey: "fake", kind: "apiKey" as const },
		httpClient: http,
		sleep: async () => {},
	};
	return {
		badge: trap,
		// Single reads only, so the live check lists game passes alone.
		developerProduct: {
			...trap,
			read: createDeveloperProductDriver({
				client: new DeveloperProductsClient(client),
				readFile: async () => new Uint8Array(),
				universeId: asRobloxAssetId("123"),
			}).read!,
		},
		gamePass: createGamePassDriver({
			client: new GamePassesClient(client),
			readFile: async () => new Uint8Array(),
			universeId: asRobloxAssetId("123"),
		}),
		place: trap,
		universe: trap,
	};
}

function importOptions({
	http,
	initial,
	overlay = { iconBaseline: "accept-local-file", importId: PASS_ID },
}: {
	readonly http: FakeHttpClient;
	readonly initial?: Readonly<Record<string, BedrockState>>;
	readonly overlay?: PassOverlay;
}) {
	const store = fakeStateStore(initial === undefined ? {} : { initial });
	return {
		options: {
			config: {
				environments: { production: { passes: { "vip-pass": overlay } } },
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip-icon.png" },
						price: 500,
					},
				},
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			registry: registryFor(http),
			statePort: store.port,
		},
		store,
	};
}

describe("game-pass import", () => {
	it("should preview an import as recorded Current state without planning a create or writing", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse({ body: listBody(), status: 200 });
		const { options, store } = importOptions({ http });
		const result = await previewDiffAsync(options);
		assert(result.success, JSON.stringify(result));

		expect(result.data.imports).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", robloxId: PASS_ID },
		]);
		expect(result.data.ops).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", type: "noop" },
		]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["GET", "GET"]);
		expect(store.writes).toBeEmpty();
	});

	it("should record an import on deploy without a write request, then plan a noop", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse({ body: listBody(), status: 200 })
			.mockResponse({ body: listBody(), status: 200 });
		const { options, store } = importOptions({ http });
		const first = await deploy(options);
		assert(first.success, JSON.stringify(first));
		const second = await previewDiffAsync(options);
		assert(second.success, JSON.stringify(second));

		expect(store.states.get("production")!.resources).toStrictEqual([
			{
				...gamePassCurrent(),
				iconFileHashes: { "en-us": EMPTY_FILE_HASH },
				isManagedPricingEnabled: false,
			},
		]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
			"GET",
			"GET",
		]);
		expect(second.data.imports).toStrictEqual([]);
		expect(second.data.ops).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", type: "noop" },
		]);
	});

	it("should deploy a recorded import as a noop without importing it again", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse({ body: listBody(), status: 200 })
			.mockResponse({ body: listBody(), status: 200 });
		const events: Array<ProgressEvent> = [];
		const { options, store } = importOptions({ http });
		await deploy(options);
		const second = await deploy({
			...options,
			progress: {
				emit: (event) => {
					events.push(event);
				},
			},
		});
		assert(second.success, JSON.stringify(second));

		expect(store.writes).toHaveLength(2);
		expect(events.map(({ kind }) => kind)).not.toContain("resourceImported");
		expect(events).toContainEqual({
			key: "vip-pass",
			environment: "production",
			kind: "resourceOpNoop",
			resourceKind: "gamePass",
		});
	});

	it("should record each of several imports under its own Key", async ({ expect }) => {
		expect.hasAssertions();

		const gold = validGamePassBody({
			name: "Gold Pass",
			description: "Gold perks.",
			gamePassId: 42,
			iconAssetId: 43,
		});
		const http = createFakeHttpClient()
			.mockResponse({ body: gold, status: 200 })
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse({
				// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
				body: { gamePasses: [gold, passBody()], nextPageToken: null },
				status: 200,
			});
		const { options } = importOptions({ http });
		const result = await previewDiffAsync({
			...options,
			config: {
				environments: {
					production: {
						passes: {
							"gold-pass": { iconBaseline: "accept-local-file", importId: "42" },
							"vip-pass": { iconBaseline: "accept-local-file", importId: PASS_ID },
						},
					},
				},
				passes: {
					"gold-pass": {
						name: "Gold Pass",
						description: "Gold perks.",
						icon: { "en-us": "assets/gold.png" },
						price: 100,
					},
					"vip-pass": options.config.passes["vip-pass"],
				},
			},
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.imports).toStrictEqual([
			{ key: "gold-pass", kind: "gamePass", robloxId: "42" },
			{ key: "vip-pass", kind: "gamePass", robloxId: PASS_ID },
		]);
		expect(result.data.ops).toStrictEqual([
			{ key: "gold-pass", kind: "gamePass", type: "noop" },
			{ key: "vip-pass", kind: "gamePass", type: "noop" },
		]);
	});

	it("should plan a differing field as an update in the import run", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passBody(120), status: 200 })
			.mockResponse({ body: listBody(120), status: 200 });
		const result = await previewDiffAsync(importOptions({ http }).options);
		assert(result.success, JSON.stringify(result));

		expect(result.data.ops).toMatchObject([{ changedFields: ["price"], type: "update" }]);
	});
});

function failingNthRead(
	port: StatePort,
	{ cause, failingRead }: { readonly cause: StateError; readonly failingRead: number },
): StatePort {
	let reads = 0;
	return {
		read: async (environment) => {
			reads += 1;
			return reads === failingRead ? { err: cause, success: false } : port.read(environment);
		},
		write: port.write,
	};
}

const SAVED_ELSEWHERE = {
	environment: "production",
	resources: [gamePassCurrent({ key: asResourceKey("gold-pass") })],
	version: 1,
} as const;
const SAVED_OTHER_ID = {
	environment: "production",
	resources: [
		gamePassCurrent({
			outputs: { ...gamePassCurrent().outputs, assetId: asRobloxAssetId("1") },
		}),
	],
	version: 1,
} as const;

describe("game-pass import refusals", () => {
	it.for([
		{
			name: "an id that is not live",
			http: () => {
				return createFakeHttpClient()
					.mockApiError({ statusCode: 404 })
					.mockApiError({ statusCode: 404 });
			},
			reason: "is not a live game pass in this Environment's universe.",
		},
		{
			name: "an id of another Kind",
			http: () => {
				return createFakeHttpClient()
					.mockApiError({ statusCode: 404 })
					.mockResponse({
						body: validDeveloperProductBody({ productId: Number(PASS_ID) }),
						status: 200,
					});
			},
			reason: "is a developer product, not a game pass.",
		},
		{
			name: "an id another Key tracks",
			http: () => createFakeHttpClient(),
			initial: { production: SAVED_ELSEWHERE },
			reason: "cannot be imported: 'gold-pass' already tracks it.",
		},
		{
			name: "a Key that already has State",
			http: () => createFakeHttpClient(),
			initial: { production: SAVED_OTHER_ID },
			reason: "cannot be imported: 'vip-pass' already has State.",
		},
		{
			name: "an icon without a baseline",
			http: () => createFakeHttpClient().mockResponse({ body: passBody(), status: 200 }),
			overlay: { importId: PASS_ID },
			reason: 'has no known icon hash: supply the icon file and add iconBaseline: "accept-local-file" beside importId.',
		},
	])(
		"should stop diff and deploy before any Operation for $name",
		async (refusal, { expect }) => {
			expect.hasAssertions();

			const results = [];
			const http = refusal.http();
			const { options, store } = importOptions({ ...refusal, http });
			results.push(await previewDiffAsync(options));
			const replay = refusal.http();
			results.push(
				await deploy({
					...importOptions({ ...refusal, http: replay }).options,
					statePort: store.port,
				}),
			);

			expect(results[0]).toStrictEqual(results[1]);

			const [result] = results;

			expect(result).toMatchObject({
				err: {
					cause: {
						key: "vip-pass",
						kind: "importRejected",
						message: `${LINE} ${refusal.reason}`,
					},
					kind: "buildDesiredFailed",
				},
				success: false,
			});
			expect(
				[...http.requests, ...replay.requests].every(
					({ request }) => request.method === "GET",
				),
			).toBeTrue();
			expect(store.writes).toBeEmpty();
		},
	);
});

describe("game-pass import reads", () => {
	it("should name the badge Kind that holds a declared pass id", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockApiError({ statusCode: 404 })
			.mockApiError({ statusCode: 404 });
		const { options } = importOptions({ http });
		const result = await previewDiffAsync({
			...options,
			registry: {
				...options.registry,
				badge: {
					...trap,
					read: async () => ({ data: { kind: "badge", outputs: {} }, success: true }),
				},
			},
		});

		expect(result).toMatchObject({
			err: { cause: { message: `${LINE} is a badge, not a game pass.` } },
		});
	});

	it.for([
		{ resourceKind: "gamePass", statusCodes: [400] },
		{ resourceKind: "developerProduct", statusCodes: [404, 400] },
	] as const)(
		"should report a failed $resourceKind read as a failed live check",
		async ({ resourceKind, statusCodes }, { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient();
			for (const statusCode of statusCodes) {
				http.mockApiError({ statusCode });
			}

			const result = await previewDiffAsync(importOptions({ http }).options);

			expect(result).toMatchObject({
				err: { kind: "liveCheckFailed", resourceKind },
				success: false,
			});
		},
	);

	it("should refuse an import no Driver can read", async ({ expect }) => {
		expect.hasAssertions();

		const { options } = importOptions({ http: createFakeHttpClient() });
		const result = await previewDiffAsync({ ...options, registry: {} });

		expect(result).toMatchObject({
			err: {
				cause: {
					message: `${LINE} cannot be read: importing needs an Open Cloud credential.`,
				},
				kind: "buildDesiredFailed",
			},
			success: false,
		});
	});

	it("should build the default readers for an import in an Environment without State", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { options } = importOptions({ http: createFakeHttpClient() });
		const result = await previewDiffAsync({
			...options,
			credential: { apiKey: "explicit", kind: "apiKey" },
			registry: undefined,
		});

		expect(result).toMatchObject({
			err: { kind: "registryConfigMissing", missing: "universeId" },
			success: false,
		});
	});

	it("should import nothing into a Key the root retires", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse({
			// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
			body: { gamePasses: [], nextPageToken: null },
			status: 200,
		});
		const { options } = importOptions({ http });
		const result = await previewDiffAsync({
			...options,
			config: { ...options.config, passes: { "vip-pass": { retired: true } } },
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.imports).toStrictEqual([]);
		expect(http.requests.map(({ request }) => request.url)).toStrictEqual([
			"/game-passes/v1/universes/123/game-passes/creator",
		]);
	});
});

describe("game-pass import on deploy", () => {
	it("should report the import on the deploy progress", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse({ body: listBody(), status: 200 });
		const events: Array<ProgressEvent> = [];
		const { options } = importOptions({ http });
		const result = await deploy({
			...options,
			progress: {
				emit: (event) => {
					events.push(event);
				},
			},
		});
		assert(result.success, JSON.stringify(result));

		expect(events.filter(({ kind }) => kind === "resourceImported")).toStrictEqual([
			{
				key: "vip-pass",
				environment: "production",
				kind: "resourceImported",
				resourceKind: "gamePass",
				robloxId: PASS_ID,
			},
		]);
	});

	it("should read only the importing entry's icon before the import", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse({ body: listBody(), status: 200 });
		const { options } = importOptions({ http });
		const result = await deploy({
			...options,
			config: {
				...options.config,
				passes: {
					...options.config.passes,
					"gold-pass": {
						name: "Gold Pass",
						description: "Gold perks.",
						icon: { "en-us": "assets/gold.png" },
					},
				},
			},
			readFile: async (path) => {
				await Promise.resolve();
				assert(path !== "assets/gold.png", "ENOENT");
				return new Uint8Array();
			},
		});

		expect(result).toMatchObject({
			err: { cause: { key: "gold-pass", kind: "fileReadFailed" } },
			success: false,
		});
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["GET", "GET"]);
	});

	it("should refuse an import whose icon file cannot be read before any Operation", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient();
		const { options, store } = importOptions({ http });
		const result = await deploy({
			...options,
			readFile: async () => {
				throw new Error("ENOENT");
			},
		});

		expect(result).toMatchObject({
			err: {
				cause: { kind: "fileReadFailed", reason: "ENOENT" },
				kind: "buildDesiredFailed",
			},
			success: false,
		});
		expect(http.requests).toBeEmpty();
		expect(store.writes).toBeEmpty();
	});

	it.for([1, 2])(
		"should report State read failure %i as a failed State read without writing",
		async (failingRead, { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient().mockResponse({ body: passBody(), status: 200 });
			const { options, store } = importOptions({ http });
			const cause = { file: "gist:abc", kind: "stateError", reason: "unreadable" } as const;
			const result = await deploy({
				...options,
				statePort: failingNthRead(store.port, { cause, failingRead }),
			});

			expect(result).toMatchObject({
				err: { cause, kind: "stateReadFailed" },
				success: false,
			});
			expect(store.writes).toBeEmpty();
		},
	);
});
