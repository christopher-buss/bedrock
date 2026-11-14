import {
	asRobloxAssetId,
	type Config,
	createBadgeDriver,
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
import type { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import { fakeStateStore } from "#tests/helpers/state-store";
import { fakeUniverses } from "#tests/helpers/universe-owner";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const USER_SOURCE = "1";
const GROUP_SOURCE = "2";

const trap = {
	async create(): Promise<never> {
		throw new Error("Unexpected create");
	},
	async retire(): Promise<never> {
		throw new Error("Unexpected retire");
	},
};

function config(paymentSource: "user" | undefined): Config {
	return {
		badges: {
			"first-win": {
				name: "First Win",
				description: "Earn First Win.",
				icon: { "en-us": "assets/badge.png" },
			},
		},
		environments: {
			production:
				paymentSource === undefined
					? { spendLimit: 100 }
					: { paymentSource, spendLimit: 100 },
		},
	};
}

async function readIconAsync(): Promise<Uint8Array> {
	return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
}

function registry(httpClient: FakeHttpClient, universes: UniversesClient): DriverRegistry {
	return {
		badge: createBadgeDriver({
			client: new BadgesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: readIconAsync,
			universeId: UNIVERSE_ID,
			universes,
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

/**
 * A badge client with no free badge quota left: the free send is refused for
 * cost, and the paid send creates the badge.
 *
 * @returns The fake transport, answering in request order.
 */
function paidCreate(): FakeHttpClient {
	return createFakeHttpClient()
		.mockResponse({ body: 0, status: 200 })
		.mockResponse({
			body: {
				badgeCreationPrice: 100,
				defaultBadgeIconImageId: 118_488_295_868_225,
				maxBadgeDescriptionLength: 1000,
				maxBadgeNameLength: 50,
			},
			status: 200,
		})
		.mockError(costRefusal())
		.mockResponse({ body: validBadgeBody({ id: 2001, iconImageId: 2002 }), status: 200 });
}

function sentSources(httpClient: FakeHttpClient): Array<[string, string]> {
	return httpClient.requests.flatMap(({ request }) => {
		if (request.method !== "POST") {
			return [];
		}

		assert(request.body instanceof FormData);
		const cost = request.body.get("expectedCost");
		const source = request.body.get("paymentSourceType");
		assert(typeof cost === "string" && typeof source === "string");
		return [[cost, source]];
	});
}

async function deployPaidAsync(
	paymentSource: "user" | undefined,
	universes: UniversesClient,
): Promise<FakeHttpClient> {
	const httpClient = paidCreate();
	const result = await deploy({
		allowSpend: true,
		config: config(paymentSource),
		environment: "production",
		live: false,
		readFile: readIconAsync,
		registry: registry(httpClient, universes),
		statePort: fakeStateStore().port,
	});
	assert(result.success, JSON.stringify(result));
	return httpClient;
}

describe("badge payment source", () => {
	it("should make the key owner pay on a group-owned universe when the environment says user", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = await deployPaidAsync("user", fakeUniverses({ owner: "group" }));

		expect(sentSources(httpClient)).toStrictEqual([
			["0", USER_SOURCE],
			["100", USER_SOURCE],
		]);
	});

	it("should make group funds pay on a group-owned universe without a payment source", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = await deployPaidAsync(undefined, fakeUniverses({ owner: "group" }));

		expect(sentSources(httpClient)).toStrictEqual([
			["0", GROUP_SOURCE],
			["100", GROUP_SOURCE],
		]);
	});

	it.for([undefined, "user"] as const)(
		"should make the user pay on a user-owned universe with a payment source of %s",
		async (paymentSource, { expect }) => {
			expect.hasAssertions();

			const httpClient = await deployPaidAsync(
				paymentSource,
				fakeUniverses({ owner: "user" }),
			);

			expect(sentSources(httpClient)).toStrictEqual([
				["0", USER_SOURCE],
				["100", USER_SOURCE],
			]);
		},
	);

	it("should not need the universe owner when the environment says user", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = await deployPaidAsync("user", fakeUniverses({ owner: "unreadable" }));

		expect(sentSources(httpClient)).toStrictEqual([
			["0", USER_SOURCE],
			["100", USER_SOURCE],
		]);
	});
});
