import {
	asRobloxAssetId,
	createGamePassDriver,
	defineConfig,
	deploy,
	type DriverRegistry,
} from "@bedrock-rbx/core";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { previewDiffAsync } from "#src/shell/preview-diff";
import { fakeStateStore } from "#tests/helpers/state-store";

const PLACEHOLDER = { name: "Coming soon", description: "Available later.", price: 7 };
const REAL_DISPLAY = { name: "VIP Pass", description: "Unlock VIP perks.", price: 500 };
const CONFIG = defineConfig({
	environments: { production: { redacted: PLACEHOLDER } },
	passes: { "vip-pass": { ...REAL_DISPLAY, icon: { "en-us": "assets/private.png" } } },
});

async function noFilesAsync(): Promise<Uint8Array> {
	throw new Error("Redaction must not read the private icon");
}

const UNUSED_DRIVER = {
	create() {
		throw new Error("Unexpected resource create");
	},
	retire() {
		throw new Error("Unexpected resource retirement");
	},
};

function registry(httpClient: FakeHttpClient): DriverRegistry {
	return {
		badge: UNUSED_DRIVER,
		developerProduct: UNUSED_DRIVER,
		gamePass: createGamePassDriver({
			client: new GamePassesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: noFilesAsync,
			universeId: asRobloxAssetId("123"),
		}),
		place: UNUSED_DRIVER,
		universe: UNUSED_DRIVER,
	};
}

function passBody(overrides: Parameters<typeof validGamePassBody>[0] = {}) {
	return validGamePassBody({
		name: PLACEHOLDER.name,
		description: PLACEHOLDER.description,
		gamePassId: 9_876_543_210,
		iconAssetId: 1_122_334_455,
		priceInformation: { defaultPriceInRobux: 7, enabledFeatures: [] },
		...overrides,
	});
}

async function redactedFixtureAsync() {
	const store = fakeStateStore();
	const seeded = await deploy({
		config: CONFIG,
		environment: "production",
		readFile: noFilesAsync,
		registry: registry(createFakeHttpClient().mockResponse({ body: passBody(), status: 200 })),
		statePort: store.port,
	});
	assert(seeded.success);

	const httpClient = createFakeHttpClient();
	return {
		httpClient,
		options: {
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: store.port,
		},
		seeded: seeded.data,
		store,
	};
}

describe("redacted Environment live check", () => {
	it("should leave configured placeholders unchanged despite real display values in State", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = await redactedFixtureAsync();
		fixture.httpClient.mockResponse({
			body: {
				gamePasses: [passBody()],
				// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
				nextPageToken: null,
			},
			status: 200,
		});
		const preview = await previewDiffAsync(fixture.options);
		assert(preview.success);

		expect(fixture.seeded).toMatchObject({
			realDisplay: { "gamePass:vip-pass": REAL_DISPLAY },
			resources: [PLACEHOLDER],
		});
		expect(preview.data).toMatchObject({
			drift: [{ key: "vip-pass", kind: "gamePass", type: "noop" }],
			liveCheck: { checkedKinds: ["gamePass"], edits: [], missing: [] },
			ops: [{ key: "vip-pass", kind: "gamePass", type: "noop" }],
		});
		expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
		expect(fixture.store.writes).toHaveLength(1);
		expect(fixture.store.states.get("production")).toStrictEqual(fixture.seeded);
	});
});
