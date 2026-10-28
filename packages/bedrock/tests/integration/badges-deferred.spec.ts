import {
	asRobloxAssetId,
	type Config,
	createBadgeDriver,
	createClackProgressAdapter,
	deploy,
	type DriverRegistry,
} from "@bedrock-rbx/core";
import { ApiError } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const QUOTA_URL = `/v1/universes/${UNIVERSE_ID}/free-badges-quota`;
const CREATE_URL = `/legacy-badges/v1/universes/${UNIVERSE_ID}/badges`;
const ICON = { "en-us": "assets/badge.png" } as const;

const CONFIG = {
	badges: {
		alpha: { name: "Alpha", description: "First.", icon: ICON },
		beta: { name: "Beta", description: "Second.", icon: ICON },
		gamma: { name: "Gamma", description: "Third.", icon: ICON },
	},
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
		}),
		developerProduct: trap,
		gamePass: trap,
		place: trap,
		universe: trap,
	};
}

function withQuota(left: number, created: ReadonlyArray<number>): FakeHttpClient {
	return created.reduce(
		(client, id) => {
			return client.mockResponse({
				body: validBadgeBody({ id, iconImageId: id + 1 }),
				status: 200,
			});
		},
		createFakeHttpClient().mockResponse({ body: left, status: 200 }),
	);
}

function postedNames(httpClient: FakeHttpClient): Array<unknown> {
	return httpClient.requests
		.filter(({ request }) => request.method === "POST")
		.map(({ request }) => {
			assert(request.body instanceof FormData);
			return request.body.get("name");
		});
}

describe("deferred badge creates", () => {
	it("should create the badges the quota covers in key order and defer the rest", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = withQuota(1, [111]);
		const store = fakeStateStore();
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data.deferredCreates).toStrictEqual([
			{ key: "beta", kind: "badge" },
			{ key: "gamma", kind: "badge" },
		]);
		expect(httpClient.requests.map(({ request }) => request.url)).toStrictEqual([
			QUOTA_URL,
			CREATE_URL,
		]);
		expect(postedNames(httpClient)).toStrictEqual(["Alpha"]);
		expect(store.states.get("dev")!.resources.map(({ key }) => key)).toStrictEqual(["alpha"]);
	});

	it.for([
		{
			created: [111],
			line: '2 badge creates deferred in "dev", no free badge quota left today: beta, gamma; the free badge quota resets at 2026-10-28 00:00 UTC',
			quota: 1,
		},
		{
			created: [111, 222],
			line: '1 badge create deferred in "dev", no free badge quota left today: gamma; the free badge quota resets at 2026-10-28 00:00 UTC',
			quota: 2,
		},
	])(
		"should warn with the deferred keys and the next quota reset at quota $quota",
		async ({ created, line, quota }, { expect, onTestFinished }) => {
			expect.hasAssertions();

			vi.useFakeTimers({ now: new Date("2026-10-27T15:30:00.000Z"), toFake: ["Date"] });
			onTestFinished(() => {
				vi.useRealTimers();
			});
			const clack = fakeClackPort();
			const result = await deploy({
				config: CONFIG,
				environment: "dev",
				progress: createClackProgressAdapter({ clack }),
				readFile: readIconAsync,
				registry: registry(withQuota(quota, created)),
				statePort: fakeStateStore().port,
			});

			assert(result.success, JSON.stringify(result));

			expect(clack.logMessage).toHaveBeenCalledWith(line);
		},
	);

	it("should report a failed create without a deferral warning", async ({ expect }) => {
		expect.hasAssertions();

		const clack = fakeClackPort();
		const httpClient = createFakeHttpClient()
			.mockResponse({ body: 1, status: 200 })
			.mockError(new ApiError("HTTP 400", { statusCode: 400 }));
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		expect(result).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(clack.logMessage).not.toHaveBeenCalledWith(expect.stringContaining("deferred"));
	});

	it("should create the deferred badges on the next deploy once the quota refreshes", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(withQuota(1, [111])),
			statePort: store.port,
		});
		const httpClient = withQuota(2, [222, 333]);
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data).not.toHaveProperty("deferredCreates");
		expect(postedNames(httpClient)).toIncludeSameMembers(["Beta", "Gamma"]);
		expect(store.states.get("dev")!.resources.map(({ key }) => key)).toIncludeSameMembers([
			"alpha",
			"beta",
			"gamma",
		]);
	});
});
