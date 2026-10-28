import {
	asRobloxAssetId,
	type Config,
	createBadgeDriver,
	deploy,
	type DriverRegistry,
} from "@bedrock-rbx/core";
import { ApiError, NetworkError } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const ICON = { "en-us": "assets/badge.png" } as const;

const CONFIG = {
	// Declared out of Key order, so the creates reach Apply out of it too.
	badges: Object.fromEntries([
		["gamma", { name: "Gamma", description: "Third.", icon: ICON }],
		["alpha", { name: "Alpha", description: "First.", icon: ICON }],
		["beta", { name: "Beta", description: "Second.", icon: ICON }],
	]),
	environments: { dev: { allowDeferredCreates: true } },
} satisfies Config;

const trap = {
	async create(): Promise<never> {
		throw new Error("Unexpected create");
	},
	async retire(): Promise<never> {
		throw new Error("Unexpected retire");
	},
};

async function readIconAsync(): Promise<Uint8Array> {
	return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
}

function registry(httpClient: FakeHttpClient, inFlight: Array<number>): DriverRegistry {
	const badge = createBadgeDriver({
		client: new BadgesClient({
			credential: { apiKey: "fake", kind: "apiKey" },
			httpClient,
			sleep: async () => {},
		}),
		readFile: readIconAsync,
		universeId: UNIVERSE_ID,
	});
	let running = 0;
	return {
		badge: {
			...badge,
			create: async (desired, context) => {
				running += 1;
				inFlight.push(running);
				const created = await badge.create(desired, context);
				running -= 1;
				return created;
			},
		},
		developerProduct: trap,
		gamePass: trap,
		place: trap,
		universe: trap,
	};
}

function unreadableQuota(): FakeHttpClient {
	return Array.from({ length: 4 }).reduce<FakeHttpClient>((client) => {
		return client.mockError(
			new NetworkError("socket reset", {
				cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
			}),
		);
	}, createFakeHttpClient());
}

function postedNames(httpClient: FakeHttpClient): Array<unknown> {
	return httpClient.requests
		.filter(({ request }) => request.method === "POST")
		.map(({ request }) => {
			assert(request.body instanceof FormData);
			return request.body.get("name");
		});
}

const COST_REFUSAL = new ApiError("HTTP 403", {
	code: "18",
	details: { errors: [{ code: 18, message: "Expected badge cost is different." }] },
	statusCode: 403,
});

describe("badge creates with an unreadable free quota", () => {
	it("should create every badge one at a time in key order", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = [111, 222, 333].reduce((client, id) => {
			return client.mockResponse({
				body: validBadgeBody({ id, iconImageId: id + 1 }),
				status: 200,
			});
		}, unreadableQuota());
		const inFlight: Array<number> = [];
		const store = fakeStateStore();
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(httpClient, inFlight),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data.deferredCreates).toBeUndefined();
		expect(postedNames(httpClient)).toStrictEqual(["Alpha", "Beta", "Gamma"]);
		expect(inFlight).toStrictEqual([1, 1, 1]);
		expect(store.states.get("dev")!.resources.map(({ key }) => key)).toIncludeSameMembers([
			"alpha",
			"beta",
			"gamma",
		]);
	});

	it("should apply other kinds in parallel while badge creates run one at a time", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const passStarted = Promise.withResolvers<undefined>();
		const httpClient = [111, 222, 333].reduce((client, id) => {
			return client.mockResponse({
				body: validBadgeBody({ id, iconImageId: id + 1 }),
				status: 200,
			});
		}, unreadableQuota());
		const badges = registry(httpClient, []);
		const result = await deploy({
			config: {
				...CONFIG,
				passes: { "vip-pass": { name: "VIP Pass", description: "Perks.", icon: ICON } },
			},
			environment: "dev",
			readFile: readIconAsync,
			registry: {
				...badges,
				badge: {
					...badges.badge,
					create: async (desired, context) => {
						await passStarted.promise;
						return badges.badge.create(desired, context);
					},
				},
				gamePass: {
					async create(desired) {
						passStarted.resolve(undefined);
						return { data: gamePassCurrent({ ...desired }), success: true };
					},
					retire: trap.retire,
				},
			},
			statePort: fakeStateStore().port,
		});

		assert(result.success, JSON.stringify(result));

		expect(postedNames(httpClient)).toStrictEqual(["Alpha", "Beta", "Gamma"]);
	});

	it("should defer every badge after the first create Roblox refuses for cost", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = unreadableQuota()
			.mockResponse({ body: validBadgeBody({ id: 111, iconImageId: 112 }), status: 200 })
			.mockError(COST_REFUSAL);
		const store = fakeStateStore();
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(httpClient, []),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data.deferredCreates).toStrictEqual([
			{ key: "beta", kind: "badge" },
			{ key: "gamma", kind: "badge" },
		]);
		expect(postedNames(httpClient)).toStrictEqual(["Alpha", "Beta"]);
		expect(store.states.get("dev")!.resources.map(({ key }) => key)).toStrictEqual(["alpha"]);
	});
});
