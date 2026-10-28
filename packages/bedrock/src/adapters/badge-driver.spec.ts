import type { ProgressEvent } from "@bedrock-rbx/core";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { badgeCurrent, badgeDesired } from "#tests/helpers/resources";
import { applyOps } from "../shell/apply-ops.ts";
import { asRobloxAssetId } from "../types/ids.ts";
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

	it("should refuse to retire a badge without an upstream request", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient();
		const events: Array<ProgressEvent> = [];
		const trap = {
			create(): never {
				throw new Error("Unexpected create");
			},
			retire(): never {
				throw new Error("Unexpected retire");
			},
		};
		const result = await applyOps(
			[{ key: badgeCurrent().key, current: badgeCurrent(), type: "retire" }],
			{
				badge: driverOver(httpClient),
				developerProduct: trap,
				gamePass: trap,
				place: trap,
				universe: trap,
			},
			{
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
			},
		);

		assert(!result.success);

		expect(result.err.failures).toMatchObject([
			{
				key: "first-win",
				cause: { message: "Badge retirement is not available at this time." },
				kind: "driverFailure",
			},
		]);
		expect(events).toContainEqual(
			expect.objectContaining({ name: "First Win", robloxId: "2468013579" }),
		);
		expect(httpClient.requests).toBeEmpty();
	});
});
