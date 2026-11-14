import {
	asRobloxAssetId,
	BadgePaymentStoppedError,
	type Config,
	createBadgeDriver,
	createClackProgressAdapter,
	deploy,
	type DriverRegistry,
	UnconfirmedPaidCreateError,
} from "@bedrock-rbx/core";
import { ApiError, BadgeInsufficientFundsError, type OpenCloudError } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { fakeStateStore } from "#tests/helpers/state-store";
import { fakeUniverses } from "#tests/helpers/universe-owner";

const UNIVERSE_ID = asRobloxAssetId("1234567890");

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

function refusal(code: number, message: string): ApiError {
	return new ApiError(`HTTP 403: ${message}`, {
		code: String(code),
		details: { errors: [{ code, message }] },
		statusCode: 403,
	});
}

function costRefusal(): ApiError {
	return refusal(18, "Expected badge cost is different from the actual badge cost.");
}

/**
 * A badge client whose free badge quota is spent and whose creates Roblox
 * all refuse for cost when sent free.
 *
 * @param creates - How many free sends Roblox refuses for cost.
 * @param free - The free badge quota the **Capacity check** reads.
 * @returns The fake HTTP client, ready for the paid sends' answers.
 */
function quotaSpent(creates: number, free = 0): FakeHttpClient {
	const httpClient = createFakeHttpClient()
		.mockResponse({ body: free, status: 200 })
		.mockResponse({
			body: {
				badgeCreationPrice: 100,
				defaultBadgeIconImageId: 118_488_295_868_225,
				maxBadgeDescriptionLength: 1000,
				maxBadgeNameLength: 50,
			},
			status: 200,
		});
	if (free > 0) {
		httpClient.mockResponse({
			body: validBadgeBody({ id: 1001, iconImageId: 1002 }),
			status: 200,
		});
	}

	for (let index = 0; index < creates; index += 1) {
		httpClient.mockError(costRefusal());
	}

	return httpClient;
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

function failureCauses(result: Awaited<ReturnType<typeof deploy>>): Map<string, OpenCloudError> {
	assert(!result.success);
	assert(result.err.kind === "applyFailed");
	return new Map(
		result.err.cause.failures.map((failure) => {
			assert(failure.kind === "driverFailure");
			return [failure.key, failure.cause];
		}),
	);
}

describe("badge payment stop", () => {
	it("should send no further paid create after Roblox refuses one for insufficient funds", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = quotaSpent(3).mockError(refusal(17, "Insufficient funds."));
		const clack = fakeClackPort();
		const result = await deploy({
			allowSpend: true,
			config: config(["a-badge", "b-badge", "c-badge"]),
			environment: "production",
			live: false,
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		expect(sentCosts(httpClient)).toStrictEqual([
			["a-badge", "0"],
			["b-badge", "0"],
			["c-badge", "0"],
			["a-badge", "100"],
		]);

		const causes = failureCauses(result);

		expect(causes.get("a-badge")).toBeInstanceOf(BadgeInsufficientFundsError);
		expect(causes.get("b-badge")).toBeInstanceOf(BadgePaymentStoppedError);
		expect(causes.get("c-badge")).toBeInstanceOf(BadgePaymentStoppedError);
		expect(clack.logError).toHaveBeenCalledWith(
			"badge.b-badge failed: Roblox refused the free create and bedrock sent no paid create, because an earlier paid create in this deploy failed: insufficient funds. Add Robux to the account that pays, then deploy again",
		);
	});

	it("should name the missing group permission when Roblox refuses a paid create for group funds", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = quotaSpent(2).mockError(
			refusal(28, "You do not have permission to spend this group's funds."),
		);
		const clack = fakeClackPort();
		const result = await deploy({
			allowSpend: true,
			config: config(["a-badge", "b-badge"]),
			environment: "production",
			live: false,
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		expect(sentCosts(httpClient)).toStrictEqual([
			["a-badge", "0"],
			["b-badge", "0"],
			["a-badge", "100"],
		]);
		expect(failureCauses(result).get("b-badge")).toBeInstanceOf(BadgePaymentStoppedError);
		expect(clack.logError).toHaveBeenCalledWith(
			"badge.a-badge failed: HTTP 403: You do not have permission to spend this group's funds. Give the API key owner a group role with the 'Spend group funds' permission, then deploy again",
		);
		expect(clack.logError).toHaveBeenCalledWith(
			"badge.b-badge failed: Roblox refused the free create and bedrock sent no paid create, because an earlier paid create in this deploy failed: the API key owner has no permission to spend the group's funds. Give the API key owner a group role with the 'Spend group funds' permission, then deploy again",
		);
	});

	it("should warn that a paid create Roblox answers with a server error may have charged", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = quotaSpent(2).mockApiError({ message: "HTTP 500", statusCode: 500 });
		const clack = fakeClackPort();
		const result = await deploy({
			allowSpend: true,
			config: config(["a-badge", "b-badge"]),
			environment: "production",
			live: false,
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		expect(sentCosts(httpClient)).toStrictEqual([
			["a-badge", "0"],
			["b-badge", "0"],
			["a-badge", "100"],
		]);

		const causes = failureCauses(result);

		expect(causes.get("a-badge")).toBeInstanceOf(UnconfirmedPaidCreateError);
		expect(causes.get("b-badge")).toBeInstanceOf(BadgePaymentStoppedError);
		expect(clack.logError).toHaveBeenCalledWith(
			"badge.a-badge failed: HTTP 500; the paid create may have completed and charged 100 Robux. Check the universe badges and the Robux transactions before you deploy again",
		);
		expect(clack.logError).toHaveBeenCalledWith(
			"badge.b-badge failed: Roblox refused the free create and bedrock sent no paid create, because an earlier paid create in this deploy failed: Roblox answered it with a server error, and it may have completed and charged. Check the universe badges and the Robux transactions before you deploy again",
		);
	});

	it("should defer the creates a payment error stopped when the environment allows deferred creates", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = quotaSpent(2, 1).mockApiError({ message: "HTTP 500", statusCode: 500 });
		const store = fakeStateStore();
		const result = await deploy({
			allowSpend: true,
			config: config(["a-badge", "b-badge", "c-badge"], true),
			environment: "production",
			live: false,
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(sentCosts(httpClient)).toStrictEqual([
			["a-badge", "0"],
			["b-badge", "0"],
			["c-badge", "0"],
			["b-badge", "100"],
		]);
		expect([...failureCauses(result)]).toStrictEqual([
			["b-badge", expect.any(UnconfirmedPaidCreateError)],
		]);
		expect(result).toMatchObject({
			err: { deferredCreates: [{ key: "c-badge", kind: "badge" }] },
		});
		expect(store.states.get("production")!.resources).toMatchObject([{ key: "a-badge" }]);
	});
});
