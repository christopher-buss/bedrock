import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import { badgeCurrent, badgeDesired } from "#tests/helpers/resources";
import { PaidSendNotStartedError } from "../core/paid-send-not-started.ts";
import { asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { createBadgeDriver } from "./badge-driver.ts";

function driverOver(httpClient: FakeHttpClient): ReturnType<typeof createBadgeDriver> {
	const credential = { apiKey: "fake", kind: "apiKey" } as const;
	return createBadgeDriver({
		client: new BadgesClient({
			credential,
			httpClient,
			sleep: async () => {},
		}),
		readFile: async () => new Uint8Array([1, 2, 3]),
		universeId: asRobloxAssetId("1234567890"),
		universes: new UniversesClient({
			credential,
			httpClient,
			sleep: async () => {},
		}),
	});
}

function withOwner(
	httpClient: FakeHttpClient,
	owner: { readonly group?: string; readonly user?: string },
): FakeHttpClient {
	return httpClient.mockResponse({
		body: validUniverseBody({ group: owner.group, user: owner.user }),
		status: 200,
	});
}

function userOwned(): FakeHttpClient {
	return withOwner(createFakeHttpClient(), { user: "users/7777" });
}

function createForm(httpClient: FakeHttpClient, index: number): FormData {
	const { body } = httpClient.requests[index]!.request;
	assert(body instanceof FormData);
	return body;
}

const OTHER_HASH = asSha256Hex("0000000000000000000000000000000000000000000000000000000000000000");

describe(createBadgeDriver, () => {
	it.for<[owner: { group?: string; user?: string }, expected: string]>([
		[{ user: "users/7777" }, "1"],
		[{ group: "groups/42" }, "2"],
	])(
		"should send a zero expected cost and the payment source of owner %o",
		async ([owner, expected], { expect }) => {
			expect.hasAssertions();

			const httpClient = withOwner(createFakeHttpClient(), owner).mockResponse({
				body: validBadgeBody(),
				status: 200,
			});
			const result = await driverOver(httpClient).create(badgeDesired());

			expect(result.success).toBeTrue();
			expect(httpClient.requests[0]!.request.url).toContain("/cloud/v2/universes/1234567890");

			const form = createForm(httpClient, 1);

			expect(form.get("paymentSourceType")).toBe(expected);
			expect(form.get("expectedCost")).toBe("0");
		},
	);

	it("should bound only the create to 120 s and send the apply signal", async ({ expect }) => {
		expect.assertions(3);

		const httpClient = userOwned().mockResponse({ body: validBadgeBody(), status: 200 });
		const controller = new AbortController();
		await driverOver(httpClient).create(badgeDesired(), { signal: controller.signal });
		controller.abort();

		expect(httpClient.requests[0]!.config.timeout).not.toBe(120_000);
		expect(httpClient.requests[1]!.config.timeout).toBe(120_000);
		expect(httpClient.requests[1]!.config.signal!.aborted).toBeTrue();
	});

	it("should fail a create without sending it when the owner read fails", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient().mockApiError({
			code: "NOT_FOUND",
			message: "Universe not found",
			statusCode: 404,
		});
		const result = await driverOver(httpClient).create(badgeDesired());

		assert(!result.success);

		expect(result.err.message).toContain("Universe not found");
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should read the owner again on the next create after a failed owner read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = withOwner(
			createFakeHttpClient().mockApiError({
				code: "NOT_FOUND",
				message: "Universe not found",
				statusCode: 404,
			}),
			{ user: "users/7777" },
		).mockResponse({ body: validBadgeBody(), status: 200 });
		const driver = driverOver(httpClient);
		const failed = await driver.create(badgeDesired());
		const retried = await driver.create(badgeDesired());

		expect(failed.success).toBeFalse();
		expect(retried.success).toBeTrue();
		expect(httpClient.requests).toHaveLength(3);
	});

	it("should send no create once stop aborts while the icon is read", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = userOwned().mockResponse({ body: validBadgeBody(), status: 200 });
		const stop = new AbortController();
		const credential = { apiKey: "fake", kind: "apiKey" } as const;
		const driver = createBadgeDriver({
			client: new BadgesClient({ credential, httpClient, sleep: async () => {} }),
			readFile: async () => {
				stop.abort();
				return new Uint8Array([1, 2, 3]);
			},
			universeId: asRobloxAssetId("1234567890"),
			universes: new UniversesClient({ credential, httpClient, sleep: async () => {} }),
		});
		const result = await driver.create(badgeDesired(), {
			expectedCost: 100,
			stop: stop.signal,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(PaidSendNotStartedError);
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should read the owner once across concurrent creates", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = userOwned()
			.mockResponse({ body: validBadgeBody({ id: 1 }), status: 200 })
			.mockResponse({ body: validBadgeBody({ id: 2 }), status: 200 });
		const driver = driverOver(httpClient);
		const results = await Promise.all([
			driver.create(badgeDesired()),
			driver.create(badgeDesired()),
		]);

		expect(results.every((result) => result.success)).toBeTrue();
		expect(httpClient.requests).toHaveLength(3);
		expect(createForm(httpClient, 2).get("paymentSourceType")).toBe("1");
	});

	it("should not read the owner to read capacity, update, or retire", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: 5, status: 200 })
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 })
			.mockResponse({ body: { targetId: 9 }, status: 200 });
		const driver = driverOver(httpClient);
		await driver.readCreateCapacity!();
		await driver.update!(badgeCurrent(), badgeDesired({ name: "Renamed" }));
		await driver.retire(badgeCurrent());

		expect(
			httpClient.requests.some(({ request }) => request.url.includes("/cloud/v2/universes")),
		).toBeFalse();
	});

	it("should pass an Open Cloud refusal of the create through unchanged", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = userOwned().mockApiError({
			code: "18",
			message: "Insufficient funds",
			statusCode: 403,
		});
		const result = await driverOver(httpClient).create(badgeDesired());

		assert(!result.success);

		expect(result.err.message).toContain("Insufficient funds");
	});

	it("should fail a create whose response carries no icon image ID", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = userOwned().mockResponse({
			body: validBadgeBody({ iconImageId: 0 }),
			status: 200,
		});
		const result = await driverOver(httpClient).create(badgeDesired());

		assert(!result.success);

		expect(result.err.message).toBe(
			"Malformed badge response: iconImageId missing after icon upload",
		);
	});

	it("should send the apply signal on the update and its icon upload", async ({ expect }) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockResponse({ body: { targetId: 9 }, status: 200 });
		const controller = new AbortController();
		await driverOver(httpClient).update!(badgeCurrent(), badgeDesired(), {
			forceIconUpload: true,
			signal: controller.signal,
		});
		controller.abort();

		expect(httpClient.requests).toHaveLength(2);
		expect(httpClient.requests[0]!.config.signal!.aborted).toBeTrue();
		expect(httpClient.requests[1]!.config.signal!.aborted).toBeTrue();
	});

	it("should send the apply signal on the owner read of a create", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = userOwned().mockResponse({ body: validBadgeBody(), status: 200 });
		const controller = new AbortController();
		await driverOver(httpClient).create(badgeDesired(), { signal: controller.signal });
		controller.abort();

		expect(httpClient.requests[0]!.config.signal!.aborted).toBeTrue();
	});

	it("should pass an Open Cloud refusal of the update through without uploading the icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient().mockApiError({
			code: "3",
			message: "Badge name is moderated",
			statusCode: 400,
		});
		const result = await driverOver(httpClient).update!(
			badgeCurrent(),
			badgeDesired({ name: "Opening Win", iconFileHashes: { "en-us": OTHER_HASH } }),
		);

		assert(!result.success);

		expect(result.err.message).toContain("Badge name is moderated");
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should pass an Open Cloud refusal of the icon upload through unchanged", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient().mockResponse({ status: 200 }).mockApiError({
			code: "4",
			message: "Icon is moderated",
			statusCode: 400,
		});
		const result = await driverOver(httpClient).update!(
			badgeCurrent(),
			badgeDesired({ iconFileHashes: { "en-us": OTHER_HASH } }),
		);

		assert(!result.success);

		expect(result.err.message).toContain("Icon is moderated");
	});

	it("should fail a retirement whose placeholder icon upload is refused", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockApiError({ code: "INTERNAL", message: "Icon rejected", statusCode: 400 });
		const result = await driverOver(httpClient).retire(badgeCurrent());

		assert(!result.success);

		expect(result.err.message).toContain("Icon rejected");
		expect(httpClient.requests).toHaveLength(2);
	});
});
