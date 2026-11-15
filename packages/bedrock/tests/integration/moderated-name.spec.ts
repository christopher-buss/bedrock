import {
	asResourceKey,
	asRobloxAssetId,
	type BedrockState,
	createDeveloperProductDriver,
	deploy,
	type DriverRegistry,
	type StatePort,
} from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { createFakeHttpClient, validDeveloperProductBody } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { BADGE_TRAP, outcomeByKey } from "#tests/helpers/drivers";
import { liveProductFixture } from "#tests/helpers/live-developer-product";
import { developerProductCurrent } from "#tests/helpers/resources";

const FILTERED = "##############";
const CONFIG = {
	environments: { production: {} },
	products: {
		"coin-pack": { name: "Coin Pack", description: "Coins." },
		"gem-pack": { name: "Gem Pack 12345", description: "Gems." },
	},
} as const;
const PRODUCT_IDS: Record<string, string> = { "coin-pack": "2", "gem-pack": "1" };

function productState(key: "coin-pack" | "gem-pack", name: string) {
	return developerProductCurrent({
		key: asResourceKey(key),
		name,
		description: CONFIG.products[key].description,
		outputs: { productId: asRobloxAssetId(PRODUCT_IDS[key]!) },
	});
}

const STORED = {
	"coin-pack": productState("coin-pack", "Coin Pack"),
	"gem-pack": productState("gem-pack", FILTERED),
};

const TRAP = {
	async create(): Promise<never> {
		throw new Error("Unexpected create");
	},
	async retire(): Promise<never> {
		throw new Error("Unexpected retire");
	},
};

type DriverCall = `${"create" | "update"}:${string}`;

function registry(calls: Array<DriverCall> = []): DriverRegistry {
	const respond = outcomeByKey<"developerProduct">(STORED);
	return {
		badge: BADGE_TRAP,
		developerProduct: {
			create: async (desired) => {
				calls.push(`create:${desired.key}`);
				return respond(desired);
			},
			retire: TRAP.retire,
			update: async (_current, desired) => {
				calls.push(`update:${desired.key}`);
				return respond(desired);
			},
		},
		gamePass: TRAP,
		place: TRAP,
		universe: TRAP,
	};
}

function stateHarness(): { port: StatePort; writes: Array<BedrockState> } {
	let state: BedrockState = { environment: "production", resources: [], version: 1 };
	const writes: Array<BedrockState> = [];
	return {
		port: {
			async read() {
				return {
					data: { state, version: { kind: "present", token: "1" } },
					success: true,
				};
			},
			async write(next) {
				state = next;
				writes.push(next);
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

async function deployOnce(port: StatePort, calls?: Array<DriverCall>) {
	return deploy({
		config: CONFIG,
		environment: "production",
		live: false,
		readFile: async () => {
			throw new Error("No icons in this fixture");
		},
		registry: registry(calls),
		statePort: port,
	});
}

const MODERATED = {
	key: "gem-pack",
	kind: "moderatedName",
	stored: FILTERED,
	submitted: "Gem Pack 12345",
};

describe("moderated developer product name", () => {
	it("should persist the stored name and fail the deploy with moderatedName", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { port, writes } = stateHarness();
		const result = await deployOnce(port);

		assert(!result.success);

		expect(result.err).toMatchObject({
			cause: { failures: [MODERATED] },
			kind: "applyFailed",
		});
		expect(writes.at(-1)!.resources).toMatchObject([
			{ key: "coin-pack", name: "Coin Pack", outputs: { productId: "2" } },
			{ key: "gem-pack", name: FILTERED, outputs: { productId: "1" } },
		]);
	});

	it("should fail again with moderatedName on a second deploy with the same config", async ({
		expect,
	}) => {
		expect.assertions(3);

		const { port, writes } = stateHarness();
		await deployOnce(port);
		const calls: Array<DriverCall> = [];
		const second = await deployOnce(port, calls);

		expect(calls).toStrictEqual(["update:gem-pack"]);
		expect(second).toMatchObject({
			err: { cause: { failures: [MODERATED] }, kind: "applyFailed" },
			success: false,
		});
		expect(writes.at(-1)!.resources).toMatchObject([
			{ key: "coin-pack", name: "Coin Pack" },
			{ key: "gem-pack", name: FILTERED, outputs: { productId: "1" } },
		]);
	});
});

describe("moderated developer product rename with the real driver", () => {
	it("should fail with moderatedName and keep the stored name when every read-back returns the pre-PATCH name", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const preRename = validDeveloperProductBody({
			name: "Gem Pack",
			description: "Stocks the player up with 1,000 premium gems.",
			iconImageAssetId: 1_122_334_455,
			productId: 8_172_635_495,
		});
		const http = createFakeHttpClient().mockResponse({ status: 204 });
		for (let read = 0; read < 3; read += 1) {
			http.mockResponse({ body: preRename, status: 200 });
		}

		const subject = liveProductFixture(http);
		const result = await deploy({
			...subject.options,
			config: {
				...subject.options.config,
				products: {
					"gem-pack": {
						...subject.options.config.products["gem-pack"],
						name: "Gem Pack 12345",
					},
				},
			},
			live: false,
			registry: {
				...subject.options.registry,
				developerProduct: createDeveloperProductDriver({
					client: new DeveloperProductsClient({
						credential: { apiKey: "fake", kind: "apiKey" },
						httpClient: http,
						sleep: async () => {},
					}),
					readFile: async () => new Uint8Array(),
					sleep: async () => {},
					universeId: asRobloxAssetId("123"),
				}),
			},
		});

		expect(result).toMatchObject({
			err: {
				cause: {
					failures: [
						{
							key: "gem-pack",
							kind: "moderatedName",
							stored: "Gem Pack",
							submitted: "Gem Pack 12345",
						},
					],
				},
				kind: "applyFailed",
			},
			success: false,
		});
		expect(subject.store.states.get("production")!.resources).toMatchObject([
			{ key: "gem-pack", name: "Gem Pack", outputs: { productId: "8172635495" } },
		]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
			"PATCH",
			"GET",
			"GET",
			"GET",
		]);
	});
});
