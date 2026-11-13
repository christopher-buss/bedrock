import { OpenCloudError } from "@bedrock-rbx/ocale";
import { AssetsClient } from "@bedrock-rbx/ocale/assets";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { createFakeHttpClient, type FakeHttpClient } from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import { asRobloxAssetId } from "../types/ids.ts";
import { createBadgeDriver } from "./badge-driver.ts";
import { createDeveloperProductDriver } from "./developer-product-driver.ts";
import { createGamePassDriver } from "./game-pass-driver.ts";

const ICON = new Uint8Array([137, 80, 78, 71]);
const ICON_ID = asRobloxAssetId("555");
const UNIVERSE = asRobloxAssetId("1");
const LOCATION = "https://cdn.example.test/v1/bytes/icon";

function clients(http: FakeHttpClient) {
	const options = {
		credential: { apiKey: "fake", kind: "apiKey" as const },
		httpClient: http,
		sleep: async () => {},
	};
	return {
		assets: new AssetsClient({ ...options, fetch: async () => new Response(ICON) }),
		options,
	};
}

function drivers(http: FakeHttpClient, withAssets = true) {
	const { assets, options } = clients(http);
	const shared = {
		...(withAssets ? { assets } : {}),
		readFile: async () => new Uint8Array(),
		universeId: UNIVERSE,
	};
	return {
		badge: createBadgeDriver({
			...shared,
			client: new BadgesClient(options),
			universes: new UniversesClient(options),
		}),
		developerProduct: createDeveloperProductDriver({
			...shared,
			client: new DeveloperProductsClient(options),
		}),
		gamePass: createGamePassDriver({ ...shared, client: new GamePassesClient(options) }),
	};
}

function locatedHttp(): FakeHttpClient {
	return createFakeHttpClient().mockResponse({ body: { location: LOCATION }, status: 200 });
}

describe("readIcon", () => {
	it("should download the stored icon of a live game pass", async ({ expect }) => {
		expect.assertions(2);

		const http = locatedHttp();
		const read = await drivers(http).gamePass.readIcon!({
			kind: "gamePass",
			outputs: { iconAssetIds: { "en-us": ICON_ID } },
		});

		expect(read).toStrictEqual({ data: ICON, success: true });
		expect(http.requests[0]!.request.url).toContain("/assetId/555");
	});

	it("should download the stored icon of a live developer product and badge", async ({
		expect,
	}) => {
		expect.assertions(2);

		const registry = drivers(
			locatedHttp().mockResponse({ body: { location: LOCATION }, status: 200 }),
		);

		await expect(
			registry.developerProduct.readIcon!({
				kind: "developerProduct",
				outputs: { iconImageAssetId: ICON_ID },
			}),
		).resolves.toStrictEqual({ data: ICON, success: true });
		await expect(
			registry.badge.readIcon!({ kind: "badge", outputs: { iconImageId: ICON_ID } }),
		).resolves.toStrictEqual({ data: ICON, success: true });
	});

	it("should read no icon for an item on the Roblox default image", async ({ expect }) => {
		expect.assertions(4);

		const http = createFakeHttpClient();
		const registry = drivers(http);

		await expect(
			registry.gamePass.readIcon!({
				kind: "gamePass",
				outputs: { iconAssetIds: undefined },
			}),
		).resolves.toStrictEqual({ data: undefined, success: true });
		await expect(
			registry.developerProduct.readIcon!({ kind: "developerProduct", outputs: {} }),
		).resolves.toStrictEqual({ data: undefined, success: true });
		await expect(
			registry.badge.readIcon!({ kind: "badge", outputs: {} }),
		).resolves.toStrictEqual({ data: undefined, success: true });
		expect(http.requests).toBeEmpty();
	});

	it("should return the download failure", async ({ expect }) => {
		expect.assertions(1);

		const http = createFakeHttpClient().mockApiError({ statusCode: 403 });
		const read = await drivers(http).gamePass.readIcon!({
			kind: "gamePass",
			outputs: { iconAssetIds: { "en-us": ICON_ID } },
		});
		assert(!read.success);

		expect(read.err).toBeInstanceOf(OpenCloudError);
	});

	it("should not offer icon reads without an assets client", ({ expect }) => {
		expect.assertions(3);

		const registry = drivers(createFakeHttpClient(), false);

		expect(registry.gamePass.readIcon).toBeUndefined();
		expect(registry.developerProduct.readIcon).toBeUndefined();
		expect(registry.badge.readIcon).toBeUndefined();
	});
});
