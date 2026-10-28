import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { badgeCurrent, badgeDesired } from "#tests/helpers/resources";
import { asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { createBadgeDriver } from "./badge-driver.ts";

function driverOver(httpClient: FakeHttpClient): ReturnType<typeof createBadgeDriver> {
	return createBadgeDriver({
		client: new BadgesClient({
			credential: { apiKey: "fake", kind: "apiKey" },
			httpClient,
			sleep: async () => {},
		}),
		readFile: async () => new Uint8Array([1, 2, 3]),
		universeId: asRobloxAssetId("1234567890"),
	});
}

const OTHER_HASH = asSha256Hex("0000000000000000000000000000000000000000000000000000000000000000");

describe(createBadgeDriver, () => {
	it("should pass an Open Cloud refusal of the create through unchanged", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient().mockApiError({
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

		const httpClient = createFakeHttpClient().mockResponse({
			body: validBadgeBody({ iconImageId: 0 }),
			status: 200,
		});
		const result = await driverOver(httpClient).create(badgeDesired());

		assert(!result.success);

		expect(result.err.message).toBe(
			"Malformed badge response: iconImageId missing after icon upload",
		);
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

		const httpClient = createFakeHttpClient().mockApiError({
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
