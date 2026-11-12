import {
	asRobloxAssetId,
	createBadgeDriver,
	createDeveloperProductDriver,
	createGamePassDriver,
	deploy,
	type DriverRegistry,
} from "@bedrock-rbx/core";
import { AssetsClient } from "@bedrock-rbx/ocale/assets";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
	validDeveloperProductBody,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import type { Config } from "#src/core/schema";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { fakeStateStore } from "#tests/helpers/state-store";

const ICON = new Uint8Array([137, 80, 78, 71, 1]);
const LOCATION = { body: { location: "https://cdn.example.test/v1/bytes/icon" }, status: 200 };
const ICON_HASH = "871923f8e5535ef938edc1ea710d5cf9e18637ce5d39feccef23030823993e4e";
const PASS_ID = "9876543210";
const NO_ICON_HASH =
	'has no known icon hash: supply the icon file and add iconBaseline: "accept-local-file" beside importId.';

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

/**
 * Real Drivers on the fake client. Products and badges read singly, so the
 * live check lists game passes alone.
 *
 * @param http - Fake client that answers every Open Cloud call.
 * @param stored - Bytes the asset CDN serves for any icon.
 * @returns Drivers that read and download through `http`.
 */
function registryFor(http: FakeHttpClient, stored: Uint8Array<ArrayBuffer> = ICON): DriverRegistry {
	const options = {
		credential: { apiKey: "fake", kind: "apiKey" as const },
		httpClient: http,
		sleep: async () => {},
	};
	const shared = {
		assets: new AssetsClient({ ...options, fetch: async () => new Response(stored) }),
		readFile: async () => new Uint8Array(),
		universeId: asRobloxAssetId("123"),
	};
	const { list: _badgeList, ...badge } = createBadgeDriver({
		...shared,
		client: new BadgesClient(options),
		universes: new UniversesClient(options),
	});
	const { list: _productList, ...developerProduct } = createDeveloperProductDriver({
		...shared,
		client: new DeveloperProductsClient(options),
	});
	return {
		badge,
		developerProduct,
		gamePass: createGamePassDriver({ ...shared, client: new GamePassesClient(options) }),
		place: trap,
		universe: trap,
	};
}

function passBody() {
	return validGamePassBody({
		name: "VIP Pass",
		description: "Grants VIP perks.",
		gamePassId: Number(PASS_ID),
		iconAssetId: 1_122_334_455,
		priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
	});
}

function badgeBody() {
	const { awarder: _awarder, ...badge } = validBadgeBody({ id: 12, iconImageId: 6 });
	return { ...badge, awardingUniverse: { id: 123, name: "Game", rootPlaceId: 456 } };
}

const PASSES = {
	"vip-pass": {
		name: "VIP Pass",
		description: "Grants VIP perks.",
		icon: { "en-us": "assets/passes/vip-pass.png" },
		price: 500,
	},
} satisfies Config["passes"];

const PASS_CONFIG: Config = {
	environments: { production: { passes: { "vip-pass": { importId: PASS_ID } } } },
	passes: PASSES,
};

function runOptions(http: FakeHttpClient, { config = PASS_CONFIG, stored = ICON } = {}) {
	const store = fakeStateStore();
	return {
		options: {
			config,
			environment: "production",
			readFile: async () => ICON,
			registry: registryFor(http, stored),
			statePort: store.port,
		},
		store,
	};
}

describe("import with a downloaded icon", () => {
	it("should record a local icon that matches the stored icon without an icon baseline", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse(LOCATION)
			// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
			.mockResponse({ body: { gamePasses: [passBody()], nextPageToken: null }, status: 200 });
		const { options: run, store } = runOptions(http);
		const result = await deploy(run);
		assert(result.success, JSON.stringify(result));

		expect(store.states.get("production")!.resources).toMatchObject([
			{ key: "vip-pass", iconFileHashes: { "en-us": ICON_HASH } },
		]);
		expect(http.requests.every(({ request }) => request.method === "GET")).toBeTrue();
	});

	it.for([
		{
			name: "a local icon that differs from the stored icon",
			http: () => {
				return createFakeHttpClient()
					.mockResponse({ body: passBody(), status: 200 })
					.mockResponse(LOCATION);
			},
			stored: new Uint8Array([1, 2, 3]),
		},
		{
			name: "a stored icon that cannot be downloaded",
			http: () => {
				return createFakeHttpClient()
					.mockResponse({ body: passBody(), status: 200 })
					.mockApiError({ statusCode: 403 });
			},
			stored: ICON,
		},
	])("should refuse $name", async ({ http, stored }, { expect }) => {
		expect.hasAssertions();

		const { options: run } = runOptions(http(), { stored });
		const result = await previewDiffAsync(run);

		expect(result).toMatchObject({
			err: {
				cause: {
					kind: "importRejected",
					message: `environments.production.passes.vip-pass.importId "${PASS_ID}" ${NO_ICON_HASH}`,
				},
				kind: "buildDesiredFailed",
			},
			success: false,
		});
	});

	it("should refuse a product icon when the product uses the Roblox default image", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse({
			// eslint-disable-next-line unicorn/no-null -- Roblox sends null without an icon.
			body: { ...validDeveloperProductBody({ productId: 11 }), iconImageAssetId: null },
			status: 200,
		});
		const { options: run } = runOptions(http, {
			config: {
				environments: { production: { products: { gems: { importId: "11" } } } },
				products: {
					gems: { name: "Gems", description: "Gems.", icon: { "en-us": "g.png" } },
				},
			},
		});
		const result = await previewDiffAsync(run);

		expect(result).toMatchObject({
			err: {
				cause: {
					message: `environments.production.products.gems.importId "11" ${NO_ICON_HASH}`,
				},
			},
			success: false,
		});
		expect(http.requests).toHaveLength(1);
	});

	it("should not download an icon the import trusts or the entry does not declare", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse({ body: validDeveloperProductBody({ productId: 11 }), status: 200 })
			// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
			.mockResponse({ body: { gamePasses: [passBody()], nextPageToken: null }, status: 200 });
		const { options: run } = runOptions(http, {
			config: {
				environments: {
					production: {
						passes: {
							"vip-pass": { iconBaseline: "accept-local-file", importId: PASS_ID },
						},
						products: { gems: { importId: "11" } },
					},
				},
				passes: PASSES,
				products: { gems: { name: "Gems", description: "Gems." } },
			},
		});
		const result = await previewDiffAsync(run);
		assert(result.success, JSON.stringify(result));

		expect(result.data.imports).toHaveLength(2);
		expect(
			http.requests.filter(({ request }) => request.url.includes("asset-delivery")),
		).toBeEmpty();
	});

	it("should check the stored icon of a product and a badge", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({
				body: validDeveloperProductBody({ iconImageAssetId: 5, productId: 11 }),
				status: 200,
			})
			.mockResponse(LOCATION)
			.mockResponse({ body: badgeBody(), status: 200 })
			.mockResponse(LOCATION)
			// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
			.mockResponse({ body: { gamePasses: [], nextPageToken: null }, status: 200 });
		const { options: run } = runOptions(http, {
			config: {
				badges: {
					winner: { name: "Winner", description: "Won.", icon: { "en-us": "w.png" } },
				},
				environments: {
					production: {
						badges: { winner: { importId: "12" } },
						products: { gems: { importId: "11" } },
					},
				},
				products: {
					gems: { name: "Gems", description: "Gems.", icon: { "en-us": "g.png" } },
				},
			},
		});
		const result = await previewDiffAsync(run);
		assert(result.success, JSON.stringify(result));

		expect(result.data.imports).toStrictEqual([
			{ key: "gems", kind: "developerProduct", robloxId: "11" },
			{ key: "winner", kind: "badge", robloxId: "12" },
		]);
	});
});
