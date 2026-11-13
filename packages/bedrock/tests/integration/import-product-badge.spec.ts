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
import type { ResourceCurrentState } from "#src/core/resources";
import type { EnvironmentEntry } from "#src/core/schema";
import type { BedrockState } from "#src/core/state";
import type { DriverRegistry } from "#src/ports/resource-driver";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { developerProductCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

type ProductOverlay = NonNullable<EnvironmentEntry["products"]>[string];

const PRODUCT_ID = "8172635495";
const EMPTY_FILE_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const PRODUCT_LINE = `environments.production.products.gem-pack.importId "${PRODUCT_ID}"`;

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

function fakeClient(http: FakeHttpClient) {
	return {
		credential: { apiKey: "fake", kind: "apiKey" as const },
		httpClient: http,
		sleep: async () => {},
	};
}

function savedIn(resource: ResourceCurrentState): Readonly<Record<string, BedrockState>> {
	return { production: { environment: "production", resources: [resource], version: 1 } };
}

function productBody() {
	return validDeveloperProductBody({
		name: "Gem Pack",
		description: "Stocks the player up with 1,000 premium gems.",
		iconImageAssetId: 5_544_332_211,
		productId: Number(PRODUCT_ID),
	});
}

function productListBody() {
	// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
	return { developerProducts: [productBody()], nextPageToken: null };
}

function productRegistry(http: FakeHttpClient): DriverRegistry {
	return {
		badge: trap,
		developerProduct: createDeveloperProductDriver({
			client: new DeveloperProductsClient(fakeClient(http)),
			readFile: async () => new Uint8Array(),
			universeId: asRobloxAssetId("123"),
		}),
		// Single reads only, so the live check lists products alone.
		gamePass: {
			...trap,
			read: createGamePassDriver({
				client: new GamePassesClient(fakeClient(http)),
				readFile: async () => new Uint8Array(),
				universeId: asRobloxAssetId("123"),
			}).read!,
		},
		place: trap,
		universe: trap,
	};
}

function productOptions({
	http,
	icon,
	initial,
	overlay = { importId: PRODUCT_ID },
}: {
	readonly http: FakeHttpClient;
	readonly icon?: { readonly "en-us": string };
	readonly initial?: Readonly<Record<string, BedrockState>>;
	readonly overlay?: ProductOverlay;
}) {
	const store = fakeStateStore(initial === undefined ? {} : { initial });
	return {
		options: {
			config: {
				environments: { production: { products: { "gem-pack": overlay } } },
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
						price: 100,
						...(icon === undefined ? {} : { icon }),
					},
				},
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			registry: productRegistry(http),
			statePort: store.port,
		},
		store,
	};
}

describe("developer-product import", () => {
	it("should preview an import as recorded Current state without planning a create or writing", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: productBody(), status: 200 })
			.mockResponse({ body: productListBody(), status: 200 });
		const { options, store } = productOptions({ http });
		const result = await previewDiffAsync(options);
		assert(result.success, JSON.stringify(result));

		expect(result.data.imports).toStrictEqual([
			{ key: "gem-pack", kind: "developerProduct", robloxId: PRODUCT_ID },
		]);
		expect(result.data.ops).toStrictEqual([
			{ key: "gem-pack", kind: "developerProduct", type: "noop" },
		]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["GET", "GET"]);
		expect(store.writes).toBeEmpty();
	});

	it("should record an import on deploy without a write request, then plan a noop", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: productBody(), status: 200 })
			.mockResponse({ body: productListBody(), status: 200 })
			.mockResponse({ body: productListBody(), status: 200 });
		const { options, store } = productOptions({ http });
		const first = await deploy(options);
		assert(first.success, JSON.stringify(first));
		const second = await previewDiffAsync(options);
		assert(second.success, JSON.stringify(second));

		expect(store.states.get("production")!.resources).toStrictEqual([
			developerProductCurrent({
				isManagedPricingEnabled: false,
				outputs: {
					iconImageAssetId: asRobloxAssetId("5544332211"),
					productId: asRobloxAssetId(PRODUCT_ID),
				},
				price: 100,
			}),
		]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
			"GET",
			"GET",
		]);
		expect(second.data.imports).toStrictEqual([]);
		expect(second.data.ops).toStrictEqual([
			{ key: "gem-pack", kind: "developerProduct", type: "noop" },
		]);
	});

	it("should record the local icon hash of a product with an icon baseline", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: productBody(), status: 200 })
			.mockResponse({ body: productListBody(), status: 200 });
		const { options, store } = productOptions({
			http,
			icon: { "en-us": "assets/gems.png" },
			overlay: { iconBaseline: "accept-local-file", importId: PRODUCT_ID },
		});
		const result = await deploy(options);
		assert(result.success, JSON.stringify(result));

		expect(store.states.get("production")!.resources).toMatchObject([
			{
				icon: { "en-us": "assets/gems.png" },
				iconFileHashes: { "en-us": EMPTY_FILE_HASH },
				outputs: { iconImageAssetId: "5544332211", productId: PRODUCT_ID },
			},
		]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["GET", "GET"]);
	});
});

describe("developer-product import refusals", () => {
	it.for([
		{
			name: "an id that is not live",
			http: () => {
				return createFakeHttpClient()
					.mockApiError({ statusCode: 404 })
					.mockApiError({ statusCode: 404 });
			},
			reason: "is not a live developer product in this Environment's universe.",
		},
		{
			name: "an id of another Kind",
			http: () => {
				return createFakeHttpClient()
					.mockApiError({ statusCode: 404 })
					.mockResponse({
						body: validGamePassBody({ gamePassId: Number(PRODUCT_ID) }),
						status: 200,
					});
			},
			reason: "is a game pass, not a developer product.",
		},
		{
			name: "an id another Key tracks",
			http: () => createFakeHttpClient(),
			initial: savedIn(
				developerProductCurrent({
					key: asResourceKey("coin-pack"),
					outputs: { productId: asRobloxAssetId(PRODUCT_ID) },
				}),
			),
			reason: "cannot be imported: 'coin-pack' already tracks it.",
		},
		{
			name: "a Key that already has State",
			http: () => createFakeHttpClient(),
			initial: savedIn(
				developerProductCurrent({ outputs: { productId: asRobloxAssetId("1") } }),
			),
			reason: "cannot be imported: 'gem-pack' already has State.",
		},
		{
			name: "an icon without a baseline",
			http: () => createFakeHttpClient().mockResponse({ body: productBody(), status: 200 }),
			icon: { "en-us": "assets/gems.png" },
			reason: 'has no known icon hash: supply the icon file and add iconBaseline: "accept-local-file" beside importId.',
		},
	])(
		"should stop diff and deploy before any Operation for $name",
		async (refusal, { expect }) => {
			expect.hasAssertions();

			const http = refusal.http();
			const { options, store } = productOptions({ ...refusal, http });
			const previewed = await previewDiffAsync(options);
			const replay = refusal.http();
			const deployed = await deploy({
				...productOptions({ ...refusal, http: replay }).options,
				statePort: store.port,
			});

			expect(previewed).toStrictEqual(deployed);
			expect(previewed).toMatchObject({
				err: {
					cause: {
						key: "gem-pack",
						kind: "importRejected",
						message: `${PRODUCT_LINE} ${refusal.reason}`,
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

describe("imports across Kinds", () => {
	it("should import a pass and a product that share a Key, each as its own Kind", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		const result = await previewDiffAsync({
			config: {
				environments: {
					production: {
						passes: { vip: { iconBaseline: "accept-local-file", importId: "42" } },
						products: { vip: { importId: PRODUCT_ID } },
					},
				},
				passes: {
					vip: {
						name: "VIP",
						description: "Perks.",
						icon: { "en-us": "assets/vip.png" },
					},
				},
				products: { vip: { name: "VIP", description: "Perks." } },
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			registry: {
				badge: trap,
				developerProduct: {
					...trap,
					read: async (id) => {
						return {
							data: { kind: "developerProduct", outputs: { productId: id } },
							success: true,
						};
					},
				},
				gamePass: {
					...trap,
					read: async () => {
						return {
							data: {
								kind: "gamePass",
								outputs: { iconAssetIds: { "en-us": asRobloxAssetId("43") } },
							},
							success: true,
						};
					},
				},
				place: trap,
				universe: trap,
			},
			statePort: store.port,
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.imports).toStrictEqual([
			{ key: "vip", kind: "gamePass", robloxId: "42" },
			{ key: "vip", kind: "developerProduct", robloxId: PRODUCT_ID },
		]);
	});
});
