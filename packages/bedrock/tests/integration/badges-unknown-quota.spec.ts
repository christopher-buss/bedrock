import {
	asRobloxAssetId,
	type Config,
	createBadgeDriver,
	deploy,
	type DriverRegistry,
	type ProgressEvent,
} from "@bedrock-rbx/core";
import { ApiError, NetworkError } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it, vi } from "vitest";

import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";
import { fakeUniverses } from "#tests/helpers/universe-owner";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const QUOTA_URL = `/v1/universes/${UNIVERSE_ID}/free-badges-quota`;
const PRICE_URL = "/v1/badges/metadata";
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
		universes: fakeUniverses(),
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

function sentCosts(httpClient: FakeHttpClient): Array<[unknown, unknown]> {
	return httpClient.requests
		.filter(({ request }) => request.method === "POST")
		.map(({ request }) => {
			assert(request.body instanceof FormData);
			return [request.body.get("name"), request.body.get("expectedCost")];
		});
}

function getUrls(httpClient: FakeHttpClient): Array<string> {
	return httpClient.requests
		.filter(({ request }) => request.method === "GET")
		.map(({ request }) => request.url);
}

function withPrice(httpClient: FakeHttpClient): FakeHttpClient {
	return httpClient.mockResponse({
		body: {
			badgeCreationPrice: 100,
			defaultBadgeIconImageId: 118_488_295_868_225,
			maxBadgeDescriptionLength: 1000,
			maxBadgeNameLength: 50,
		},
		status: 200,
	});
}

function withCreated(httpClient: FakeHttpClient, id: number): FakeHttpClient {
	return httpClient.mockResponse({
		body: validBadgeBody({ id, iconImageId: id + 1 }),
		status: 200,
	});
}

function spending(spendLimit: number, allowDeferredCreates: boolean): Config {
	return { ...CONFIG, environments: { dev: { allowDeferredCreates, spendLimit } } };
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
			live: false,
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
			live: false,
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
			live: false,
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

describe("paid badge creates with an unreadable free quota", () => {
	it("should pay one create at a time when every create fits the spend limit", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = withCreated(
			withCreated(
				withCreated(withPrice(unreadableQuota()).mockError(COST_REFUSAL), 111),
				222,
			).mockError(COST_REFUSAL),
			333,
		);
		const inFlight: Array<number> = [];
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: spending(300, false),
			environment: "dev",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient, inFlight),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(getUrls(httpClient)).toStrictEqual([
			...Array.from<string>({ length: 4 }).fill(QUOTA_URL),
			PRICE_URL,
		]);
		expect(sentCosts(httpClient)).toStrictEqual([
			["Alpha", "0"],
			["Alpha", "100"],
			["Beta", "0"],
			["Gamma", "0"],
			["Gamma", "100"],
		]);
		expect(inFlight).toStrictEqual([1, 1, 1, 1, 1]);
		expect({
			deferredCreates: result.data.deferredCreates,
			paidCreates: result.data.paidCreates,
			robuxSpent: result.data.robuxSpent,
		}).toStrictEqual({
			deferredCreates: undefined,
			paidCreates: ["alpha", "gamma"],
			robuxSpent: 200,
		});
		expect(store.states.get("dev")!.resources.map(({ key }) => key)).toIncludeSameMembers([
			"alpha",
			"beta",
			"gamma",
		]);
	});

	it("should refuse the deploy before any operation when the worst case exceeds the spend limit", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers({ now: new Date("2026-11-14T15:30:00.000Z"), toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const httpClient = withPrice(unreadableQuota());
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: spending(299, false),
			environment: "dev",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient, []),
			statePort: store.port,
		});

		assert(!result.success);
		assert(result.err.kind === "badgeQuotaExceeded");

		const { cause, ...refusal } = result.err;

		expect(cause).toBeInstanceOf(NetworkError);
		expect(refusal).toStrictEqual({
			available: undefined,
			kind: "badgeQuotaExceeded",
			needed: 3,
			resetsAt: new Date("2026-11-15T00:00:00.000Z"),
			spend: { limit: 299, needed: 300, price: 100 },
		});
		expect(sentCosts(httpClient)).toBeEmpty();
		expect(store.writes).toBeEmpty();
	});

	it("should pay for nothing and defer after the first cost refusal when the worst case exceeds the spend limit", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = withPrice(unreadableQuota()).mockError(COST_REFUSAL);
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: spending(100, true),
			environment: "dev",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient, []),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(sentCosts(httpClient)).toStrictEqual([["Alpha", "0"]]);
		expect({
			deferredCreates: result.data.deferredCreates,
			paidCreates: result.data.paidCreates,
			robuxSpent: result.data.robuxSpent,
		}).toStrictEqual({
			deferredCreates: [
				{ key: "alpha", kind: "badge" },
				{ key: "beta", kind: "badge" },
				{ key: "gamma", kind: "badge" },
			],
			paidCreates: undefined,
			robuxSpent: undefined,
		});
		expect(store.states.get("dev")!.resources).toBeEmpty();
	});

	it("should report a deferral of a paying run without its worst-case quote", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers({ now: new Date("2026-11-14T15:30:00.000Z"), toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		// The price rises between the read and the paid send, so Roblox
		// refuses the paid send for cost too.
		const httpClient = withPrice(unreadableQuota())
			.mockError(COST_REFUSAL)
			.mockError(COST_REFUSAL);
		const events: Array<ProgressEvent> = [];
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: spending(300, true),
			environment: "dev",
			live: false,
			progress: {
				emit: (event) => {
					events.push(event);
				},
			},
			readFile: readIconAsync,
			registry: registry(httpClient, []),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(sentCosts(httpClient)).toStrictEqual([
			["Alpha", "0"],
			["Alpha", "100"],
		]);
		expect(events.filter((event) => event.kind === "badgeCreatesDeferred")).toStrictEqual([
			{
				deferred: [
					{ key: "alpha", kind: "badge" },
					{ key: "beta", kind: "badge" },
					{ key: "gamma", kind: "badge" },
				],
				environment: "dev",
				kind: "badgeCreatesDeferred",
				resetsAt: new Date("2026-11-15T00:00:00.000Z"),
			},
		]);
		expect({
			deferredCreates: result.data.deferredCreates,
			paidCreates: result.data.paidCreates,
			robuxSpent: result.data.robuxSpent,
		}).toStrictEqual({
			deferredCreates: [
				{ key: "alpha", kind: "badge" },
				{ key: "beta", kind: "badge" },
				{ key: "gamma", kind: "badge" },
			],
			paidCreates: undefined,
			robuxSpent: undefined,
		});
		expect(store.states.get("dev")!.resources).toBeEmpty();
	});
});
