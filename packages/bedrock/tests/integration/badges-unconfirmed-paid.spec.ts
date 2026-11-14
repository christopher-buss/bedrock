import {
	asResourceKey,
	asRobloxAssetId,
	type Config,
	createBadgeDriver,
	deploy,
	type DriverRegistry,
} from "@bedrock-rbx/core";
import { ApiError } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import { createFakeHttpClient, type FakeHttpClient } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it, type TestContext, vi } from "vitest";

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
});
