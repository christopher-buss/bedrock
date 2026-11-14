import {
	asResourceKey,
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

import { assert, describe, it, type TestContext, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { fakeStateStore } from "#tests/helpers/state-store";
import { fakeUniverses } from "#tests/helpers/universe-owner";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const SENT_AT = "2026-11-13T10:00:00.000Z";

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

function config(keys: ReadonlyArray<string>, allowDeferredCreates = false): Config {
	return {
		badges: Object.fromEntries(keys.map((key) => [key, badge(key)])),
		environments: { production: { allowDeferredCreates, spendLimit: 1000 } },
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
	const message = "Expected badge cost is different from the actual badge cost.";
	return new ApiError(`HTTP 403: ${message}`, {
		code: "18",
		details: { errors: [{ code: 18, message }] },
		statusCode: 403,
	});
}

/**
 * A badge client whose free badge quota is spent and whose creates Roblox
 * all refuse for cost when sent free.
 *
 * @param creates - How many free sends Roblox refuses for cost.
 * @returns The fake HTTP client, ready for the paid sends' answers.
 */
function quotaSpent(creates: number): FakeHttpClient {
	const httpClient = createFakeHttpClient()
		.mockResponse({ body: 0, status: 200 })
		.mockResponse({
			body: {
				badgeCreationPrice: 100,
				defaultBadgeIconImageId: 118_488_295_868_225,
				maxBadgeDescriptionLength: 1000,
				maxBadgeNameLength: 50,
			},
			status: 200,
		});
	for (let index = 0; index < creates; index += 1) {
		httpClient.mockError(costRefusal());
	}

	return httpClient;
}

/**
 * A State store whose saved State marks the `a-badge` create unconfirmed.
 *
 * @returns An empty production State, but for the marker.
 */
function markedStore(): ReturnType<typeof fakeStateStore> {
	return fakeStateStore({
		initial: {
			production: {
				environment: "production",
				resources: [],
				unconfirmedPaidCreates: [
					{ key: asResourceKey("a-badge"), name: "a-badge", sentAt: SENT_AT },
				],
				version: 1,
			},
		},
	});
}

function postedNames(httpClient: FakeHttpClient): Array<string> {
	return httpClient.requests.flatMap(({ request }) => {
		if (request.method !== "POST") {
			return [];
		}

		assert(request.body instanceof FormData);
		const name = request.body.get("name");
		assert(typeof name === "string");
		return [name];
	});
}

function freezeDate(onTestFinished: TestContext["onTestFinished"]): void {
	vi.useFakeTimers({ now: new Date(SENT_AT), toFake: ["Date"] });
	onTestFinished(() => {
		vi.useRealTimers();
	});
}

describe("unconfirmed paid badge creates", () => {
	it("should record a paid create Roblox answers with a server error as unconfirmed", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		freezeDate(onTestFinished);
		const httpClient = quotaSpent(2).mockApiError({ message: "HTTP 500", statusCode: 500 });
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: config(["a-badge", "b-badge"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(!result.success);

		expect(result.err.kind).toBe("applyFailed");
		expect(store.states.get("production")!.unconfirmedPaidCreates).toStrictEqual([
			{ key: asResourceKey("a-badge"), name: "a-badge", sentAt: SENT_AT },
		]);
	});

	it("should not record a paid create Roblox refuses for insufficient funds", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const message = "Insufficient funds.";
		const httpClient = quotaSpent(1).mockError(
			new ApiError(`HTTP 403: ${message}`, {
				code: "17",
				details: { errors: [{ code: 17, message }] },
				statusCode: 403,
			}),
		);
		const store = fakeStateStore();
		await deploy({
			allowSpend: true,
			config: config(["a-badge"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(store.states.get("production")).toStrictEqual({
			environment: "production",
			resources: [],
			version: 1,
		});
	});

	it("should refuse a deploy that would create a badge marked unconfirmed", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient().mockResponse({
			body: { data: [], nextPageCursor: undefined },
			status: 200,
		});
		const clack = fakeClackPort();
		const store = markedStore();
		const result = await deploy({
			allowSpend: true,
			config: config(["a-badge", "b-badge"]),
			environment: "production",
			live: false,
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(result).toStrictEqual({
			err: {
				creates: [{ key: asResourceKey("a-badge"), name: "a-badge", sentAt: SENT_AT }],
				kind: "unconfirmedPaidCreates",
			},
			success: false,
		});
		expect(postedNames(httpClient)).toStrictEqual([]);
		expect(store.writes).toStrictEqual([]);
		expect(clack.logError).toHaveBeenCalledWith(
			`deploy refused: a paid create sent for badge.a-badge at ${SENT_AT} got a server error, so Roblox may have made the badge "a-badge" and charged for it. If the badge exists, import it; if it does not, deploy again with --confirm-no-badge a-badge`,
		);
	});

	it("should keep the marker of a badge the config no longer declares", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: 1, status: 200 })
			.mockResponse({ body: validBadgeBody({ id: 1001, iconImageId: 1002 }), status: 200 });
		const store = markedStore();
		const result = await deploy({
			config: config(["b-badge"]),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(result.success).toBeTrue();
		expect(postedNames(httpClient)).toStrictEqual(["b-badge"]);
		expect(store.states.get("production")!.unconfirmedPaidCreates).toStrictEqual([
			{ key: asResourceKey("a-badge"), name: "a-badge", sentAt: SENT_AT },
		]);
	});

	it("should name every marked badge in the refusal", async ({ expect }) => {
		expect.hasAssertions();

		const clack = fakeClackPort();
		await deploy({
			config: config(["a-badge", "b-badge"]),
			environment: "production",
			live: false,
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(createFakeHttpClient()),
			statePort: fakeStateStore({
				initial: {
					production: {
						environment: "production",
						resources: [],
						unconfirmedPaidCreates: [
							{ key: asResourceKey("a-badge"), name: "A", sentAt: SENT_AT },
							{ key: asResourceKey("b-badge"), name: "B", sentAt: SENT_AT },
						],
						version: 1,
					},
				},
			}).port,
		});

		expect(clack.logError).toHaveBeenCalledWith(
			`deploy refused: a paid create sent for badge.a-badge at ${SENT_AT} got a server error, so Roblox may have made the badge "A" and charged for it; a paid create sent for badge.b-badge at ${SENT_AT} got a server error, so Roblox may have made the badge "B" and charged for it. If the badge exists, import it; if it does not, deploy again with --confirm-no-badge a-badge --confirm-no-badge b-badge`,
		);
	});
});
