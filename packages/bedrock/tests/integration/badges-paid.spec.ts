import {
	asRobloxAssetId,
	type Config,
	createBadgeDriver,
	createClackProgressAdapter,
	deploy,
	type DriverRegistry,
} from "@bedrock-rbx/core";
import { ApiError, BadgeCostMismatchError } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { fakeStateStore } from "#tests/helpers/state-store";
import { fakeUniverses } from "#tests/helpers/universe-owner";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const QUOTA_URL = `/v1/universes/${UNIVERSE_ID}/free-badges-quota`;
const PRICE_URL = "/v1/badges/metadata";
const CREATE_URL = `/legacy-badges/v1/universes/${UNIVERSE_ID}/badges`;

const trap = {
	async create(): Promise<never> {
		throw new Error("Unexpected create");
	},
	async retire(): Promise<never> {
		throw new Error("Unexpected retire");
	},
};

function badge(name: string): { description: string; icon: { "en-us": string }; name: string } {
	return { name, description: `Earn ${name}.`, icon: { "en-us": "assets/badge.png" } };
}

function config(spendLimit: number | undefined, keys: ReadonlyArray<string>): Config {
	return {
		badges: Object.fromEntries(keys.map((key) => [key, badge(key)])),
		environments: { production: spendLimit === undefined ? {} : { spendLimit } },
	};
}

function deferringConfig(spendLimit: number, keys: ReadonlyArray<string>): Config {
	return {
		badges: Object.fromEntries(keys.map((key) => [key, badge(key)])),
		environments: { dev: { allowDeferredCreates: true, spendLimit } },
	};
}

async function readIconAsync(): Promise<Uint8Array> {
	return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
}

function registry(httpClient: FakeHttpClient): DriverRegistry {
	return {
		badge: createBadgeDriver({
			client: new BadgesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: readIconAsync,
			universeId: UNIVERSE_ID,
			universes: fakeUniverses(),
		}),
		developerProduct: trap,
		gamePass: trap,
		place: trap,
		universe: trap,
	};
}

function costRefusal(): ApiError {
	return new ApiError("HTTP 403", {
		code: "18",
		details: {
			errors: [
				{
					code: 18,
					message: "Expected badge cost is different from the actual badge cost.",
				},
			],
		},
		statusCode: 403,
	});
}

function quotaAndPrice(left: number): FakeHttpClient {
	return createFakeHttpClient()
		.mockResponse({ body: left, status: 200 })
		.mockResponse({
			body: {
				badgeCreationPrice: 100,
				defaultBadgeIconImageId: 118_488_295_868_225,
				maxBadgeDescriptionLength: 1000,
				maxBadgeNameLength: 50,
			},
			status: 200,
		});
}

function created(httpClient: FakeHttpClient, id: number): FakeHttpClient {
	return httpClient.mockResponse({
		body: validBadgeBody({ id, iconImageId: id + 1 }),
		status: 200,
	});
}

function requestLines(httpClient: FakeHttpClient): Array<[string, string]> {
	return httpClient.requests.map(({ request }) => [request.method, request.url]);
}

function sentCosts(httpClient: FakeHttpClient): Array<[string, string]> {
	return httpClient.requests.flatMap(({ request }) => {
		if (request.method !== "POST") {
			return [];
		}

		assert(request.body instanceof FormData);
		const name = request.body.get("name");
		const cost = request.body.get("expectedCost");
		assert(typeof name === "string" && typeof cost === "string");
		return [[name, cost]];
	});
}

function freezeDate(onTestFinished: (cleanup: () => void) => void): void {
	vi.useFakeTimers({ now: new Date("2026-11-14T15:30:00.000Z"), toFake: ["Date"] });
	onTestFinished(() => {
		vi.useRealTimers();
	});
}

describe("paid badge creates", () => {
	it("should pay the live price for a create the free badge quota does not cover", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = created(quotaAndPrice(0).mockError(costRefusal()), 2001);
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: config(100, ["first-win"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(requestLines(httpClient)).toStrictEqual([
			["GET", QUOTA_URL],
			["GET", PRICE_URL],
			["POST", CREATE_URL],
			["POST", CREATE_URL],
		]);
		expect(sentCosts(httpClient)).toStrictEqual([
			["first-win", "0"],
			["first-win", "100"],
		]);
		expect(result.data.paidCreates).toStrictEqual(["first-win"]);
		expect(result.data.robuxSpent).toBe(100);
		expect(store.states.get("production")!.resources).toMatchObject([
			{ key: "first-win", outputs: { badgeId: "2001", iconImageId: "2002" } },
		]);
	});

	it("should create every badge when the spend limit covers the shortfall", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = created(
			created(
				created(quotaAndPrice(1), 1001).mockError(costRefusal()).mockError(costRefusal()),
				2001,
			),
			3001,
		);
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: config(200, ["a-badge", "b-badge", "c-badge"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(sentCosts(httpClient)).toStrictEqual([
			["a-badge", "0"],
			["b-badge", "0"],
			["c-badge", "0"],
			["b-badge", "100"],
			["c-badge", "100"],
		]);
		expect(result.data.paidCreates).toStrictEqual(["b-badge", "c-badge"]);
		expect(result.data.robuxSpent).toBe(200);
		expect(
			store.states
				.get("production")!
				.resources.map(({ key }) => key)
				.toSorted(),
		).toStrictEqual(["a-badge", "b-badge", "c-badge"]);
	});

	it("should never send a cost when the free badge quota covers every create", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = created(
			createFakeHttpClient().mockResponse({ body: 1, status: 200 }),
			1001,
		);
		const result = await deploy({
			allowSpend: true,
			config: config(100, ["first-win"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		assert(result.success, JSON.stringify(result));

		expect(requestLines(httpClient)).toStrictEqual([
			["GET", QUOTA_URL],
			["POST", CREATE_URL],
		]);
		expect(sentCosts(httpClient)).toStrictEqual([["first-win", "0"]]);
		expect(result.data).not.toHaveProperty("paidCreates");
		expect(result.data).not.toHaveProperty("robuxSpent");
	});

	it("should refuse the deploy before any operation when the spend limit is too low", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		freezeDate(onTestFinished);
		const httpClient = quotaAndPrice(1);
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: config(199, ["a-badge", "b-badge", "c-badge"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(result).toStrictEqual({
			err: {
				available: 1,
				kind: "badgeQuotaExceeded",
				needed: 3,
				resetsAt: new Date("2026-11-15T00:00:00.000Z"),
				spend: { limit: 199, needed: 200, price: 100 },
			},
			success: false,
		});
		expect(requestLines(httpClient)).toStrictEqual([
			["GET", QUOTA_URL],
			["GET", PRICE_URL],
		]);
		expect(store.writes).toBeEmpty();
	});

	it.for([
		{ keys: ["first-win"], left: 0, paid: 1, spendLimit: 1000 },
		{ keys: ["a-badge", "b-badge", "c-badge"], left: 1, paid: 2, spendLimit: 350 },
	])(
		"should quote $paid paid creates under a $spendLimit Robux limit when the deploy has no spend approval",
		async ({ keys, left, paid, spendLimit }, { expect, onTestFinished }) => {
			expect.hasAssertions();

			freezeDate(onTestFinished);
			const httpClient = quotaAndPrice(left);
			const store = fakeStateStore();
			const result = await deploy({
				config: config(spendLimit, keys),
				environment: "production",
				live: false,
				readFile: readIconAsync,
				registry: registry(httpClient),
				statePort: store.port,
			});

			expect(result).toStrictEqual({
				err: {
					available: left,
					kind: "badgeQuotaExceeded",
					needed: keys.length,
					resetsAt: new Date("2026-11-15T00:00:00.000Z"),
					spendQuote: { approved: false, limit: spendLimit, paid, price: 100 },
				},
				success: false,
			});
			expect(requestLines(httpClient)).toStrictEqual([
				["GET", QUOTA_URL],
				["GET", PRICE_URL],
			]);
			expect(store.writes).toBeEmpty();
		},
	);

	it("should refuse without a quote when the price cannot be read and the deploy has no spend approval", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		freezeDate(onTestFinished);
		const httpClient = createFakeHttpClient()
			.mockResponse({ body: 0, status: 200 })
			.mockApiError({ statusCode: 400 });
		const result = await deploy({
			config: config(100, ["first-win"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		expect(result).toStrictEqual({
			err: {
				available: 0,
				kind: "badgeQuotaExceeded",
				needed: 1,
				resetsAt: new Date("2026-11-15T00:00:00.000Z"),
			},
			success: false,
		});
	});

	it.for([
		{
			spendLimit: 150,
			suffix: "; --allow-spend pays for 1 of them: 100 Robux each, 100 Robux of the 150 Robux spend limit",
		},
		{
			spendLimit: 500,
			suffix: "; --allow-spend pays for 2 of them: 100 Robux each, 200 Robux of the 500 Robux spend limit",
		},
		{ spendLimit: 50, suffix: "" },
	])(
		"should name what --allow-spend would pay for deferred creates under a $spendLimit Robux limit",
		async ({ spendLimit, suffix }, { expect, onTestFinished }) => {
			expect.hasAssertions();

			freezeDate(onTestFinished);
			const clack = fakeClackPort();
			const httpClient = created(quotaAndPrice(1), 2001);
			const result = await deploy({
				config: {
					...config(undefined, ["a-badge", "b-badge", "c-badge"]),
					environments: { production: { allowDeferredCreates: true, spendLimit } },
				},
				environment: "production",
				live: false,
				progress: createClackProgressAdapter({ clack }),
				readFile: readIconAsync,
				registry: registry(httpClient),
				statePort: fakeStateStore().port,
			});

			assert(result.success, JSON.stringify(result));

			expect(requestLines(httpClient)).toStrictEqual([
				["GET", QUOTA_URL],
				["GET", PRICE_URL],
				["POST", CREATE_URL],
			]);
			expect(clack.logMessage).toHaveBeenCalledWith(
				`2 badge creates deferred in "production", no free badge quota left today: b-badge, c-badge; the free badge quota resets at 2026-11-15 00:00 UTC${suffix}`,
			);
		},
	);

	it.for([
		{ allowSpend: true, spendLimit: 0 },
		{ allowSpend: true, spendLimit: undefined },
	])(
		"should refuse as without a spend limit when spend approval is $allowSpend and the limit is $spendLimit",
		async ({ allowSpend, spendLimit }, { expect, onTestFinished }) => {
			expect.hasAssertions();

			freezeDate(onTestFinished);
			const httpClient = quotaAndPrice(0);
			const store = fakeStateStore();
			const result = await deploy({
				allowSpend,
				config: config(spendLimit, ["first-win"]),
				environment: "production",
				live: false,
				readFile: readIconAsync,
				registry: registry(httpClient),
				statePort: store.port,
			});

			expect(result).toStrictEqual({
				err: {
					available: 0,
					kind: "badgeQuotaExceeded",
					needed: 1,
					resetsAt: new Date("2026-11-15T00:00:00.000Z"),
				},
				success: false,
			});
			expect(requestLines(httpClient)).toStrictEqual([["GET", QUOTA_URL]]);
			expect(store.writes).toBeEmpty();
		},
	);

	it("should refuse the deploy with the cause when the price cannot be read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: 0, status: 200 })
			.mockApiError({ statusCode: 400 });
		const result = await deploy({
			allowSpend: true,
			config: config(100, ["first-win"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		assert(!result.success);
		assert(result.err.kind === "badgeQuotaExceeded");

		expect(result.err.available).toBe(0);
		expect(result.err.needed).toBe(1);
		expect(result.err.cause).toBeInstanceOf(ApiError);
		expect(result.err).not.toHaveProperty("spend");
	});

	it("should not pay twice past the spend limit when the free badge quota was stale", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = created(
			quotaAndPrice(1).mockError(costRefusal()).mockError(costRefusal()),
			2001,
		);
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: config(100, ["a-badge", "b-badge"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(!result.success);
		assert(result.err.kind === "applyFailed");

		expect(sentCosts(httpClient)).toStrictEqual([
			["a-badge", "0"],
			["b-badge", "0"],
			["a-badge", "100"],
		]);

		const failures = result.err.cause.failures.map((failure) => {
			assert("cause" in failure);
			return [failure.key, failure.cause instanceof BadgeCostMismatchError];
		});

		expect(failures).toStrictEqual([["b-badge", true]]);
		expect({
			paidCreates: result.err.paidCreates,
			robuxSpent: result.err.robuxSpent,
		}).toStrictEqual({ paidCreates: ["a-badge"], robuxSpent: 100 });
		expect(store.states.get("production")!.resources).toMatchObject([{ key: "a-badge" }]);
	});

	it("should spend nothing when Roblox refuses the paid send", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = quotaAndPrice(0)
			.mockError(costRefusal())
			.mockApiError({ code: "INTERNAL", statusCode: 400 });
		const result = await deploy({
			allowSpend: true,
			config: config(100, ["first-win"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		assert(!result.success);

		expect(result.err.kind).toBe("applyFailed");
		expect(sentCosts(httpClient)).toStrictEqual([
			["first-win", "0"],
			["first-win", "100"],
		]);
		expect(result.err).not.toHaveProperty("paidCreates");
		expect(result.err).not.toHaveProperty("robuxSpent");
	});
});

describe("paid badge creates with deferral", () => {
	it("should pay for the creates the spend limit covers in key order and defer the rest", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = created(created(quotaAndPrice(1), 1001).mockError(costRefusal()), 2001);
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: deferringConfig(150, ["c-badge", "a-badge", "b-badge"]),
			environment: "dev",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(requestLines(httpClient)).toStrictEqual([
			["GET", QUOTA_URL],
			["GET", PRICE_URL],
			["POST", CREATE_URL],
			["POST", CREATE_URL],
			["POST", CREATE_URL],
		]);
		expect(sentCosts(httpClient)).toStrictEqual([
			["a-badge", "0"],
			["b-badge", "0"],
			["b-badge", "100"],
		]);
		expect({
			deferredCreates: result.data.deferredCreates,
			paidCreates: result.data.paidCreates,
			robuxSpent: result.data.robuxSpent,
		}).toStrictEqual({
			deferredCreates: [{ key: "c-badge", kind: "badge" }],
			paidCreates: ["b-badge"],
			robuxSpent: 100,
		});
		expect(
			store.states
				.get("dev")!
				.resources.map(({ key }) => key)
				.toSorted(),
		).toStrictEqual(["a-badge", "b-badge"]);
	});

	it("should defer every create beyond the quota when the spend limit is below the price", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = created(quotaAndPrice(1), 1001);
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: deferringConfig(99, ["a-badge", "b-badge"]),
			environment: "dev",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(sentCosts(httpClient)).toStrictEqual([["a-badge", "0"]]);
		expect(result.data.deferredCreates).toStrictEqual([{ key: "b-badge", kind: "badge" }]);
		expect(result.data).not.toHaveProperty("paidCreates");
		expect(store.states.get("dev")!.resources).toMatchObject([{ key: "a-badge" }]);
	});

	it("should defer a create refused for cost that the spend limit can no longer pay for", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = created(
			quotaAndPrice(1).mockError(costRefusal()).mockError(costRefusal()),
			2001,
		);
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: deferringConfig(100, ["a-badge", "b-badge"]),
			environment: "dev",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(sentCosts(httpClient)).toStrictEqual([
			["a-badge", "0"],
			["b-badge", "0"],
			["a-badge", "100"],
		]);
		expect(result.data.deferredCreates).toStrictEqual([{ key: "b-badge", kind: "badge" }]);
		expect(result.data.paidCreates).toStrictEqual(["a-badge"]);
		expect(store.states.get("dev")!.resources).toMatchObject([{ key: "a-badge" }]);
	});
});
