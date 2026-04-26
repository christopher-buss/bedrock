import { ApiError } from "@bedrock/ocale";
import { DeveloperProductsClient } from "@bedrock/ocale/developer-products";
import { createFakeHttpClient, validDeveloperProductBody } from "@bedrock/ocale/testing";

import { developerProductDesired } from "#tests/helpers/resources";
import type { Except } from "type-fest";
import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId } from "../types/ids.ts";
import {
	createDeveloperProductDriver,
	type DeveloperProductDriverDeps,
} from "./developer-product-driver.ts";

const UNIVERSE_ID = asRobloxAssetId("1234567890");

const WIRE_BODY = validDeveloperProductBody({
	name: "Gem Pack",
	description: "Stocks the player up with 1,000 premium gems.",
	iconImageAssetId: 1_122_334_455,
	productId: 8_172_635_495,
	universeId: 1_234_567_890,
});

function makeDriver(overrides?: Partial<Except<DeveloperProductDriverDeps, "client">>) {
	const http = createFakeHttpClient();
	const driver = createDeveloperProductDriver({
		client: new DeveloperProductsClient({
			apiKey: "test-api-key",
			httpClient: http,
			sleep: async () => {},
		}),
		universeId: UNIVERSE_ID,
		...overrides,
	});
	return { driver, http };
}

function readFormString(body: unknown, key: string): string {
	assert(body instanceof FormData);
	const value = body.get(key);
	assert(typeof value === "string");
	return value;
}

describe(createDeveloperProductDriver, () => {
	it("should compose current state by merging desired fields with Roblox-assigned outputs", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		const desired = developerProductDesired();
		const result = await driver.create(desired);

		assert(result.success);

		expect(result.data).toStrictEqual({
			...desired,
			outputs: {
				iconImageAssetId: "1122334455",
				productId: "8172635495",
			},
		});
	});

	it("should omit iconImageAssetId from the outputs key set when the response carries no icon", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		// The wire schema requires `iconImageAssetId` to be present but
		// nullable; JSON.parse keeps the null at runtime so the response
		// matches the spec even though `null` is banned in source.
		const noIconBody = validDeveloperProductBody();
		http.mockResponse({
			body: { ...noIconBody, iconImageAssetId: JSON.parse("null") },
			status: 200,
		});

		const result = await driver.create(developerProductDesired());

		assert(result.success);

		// `toStrictEqual` distinguishes a missing key from a key present
		// with undefined value; the driver must produce the former so
		// state-file diffs do not record a phantom iconImageAssetId.
		expect(result.data.outputs).toStrictEqual({ productId: String(noIconBody.productId) });
		expect("iconImageAssetId" in result.data.outputs).toBeFalse();
	});

	it("should POST to the Open Cloud create-developer-product endpoint for the configured universe", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired());

		const captured = http.requests[0]!;

		expect(captured.request.method).toBe("POST");
		expect(captured.request.url).toBe(
			`/developer-products/v2/universes/${UNIVERSE_ID}/developer-products`,
		);
	});

	it("should send name and description in the multipart body", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired());

		const captured = http.requests[0]!;

		expect(readFormString(captured.request.body, "name")).toBe("Gem Pack");
		expect(readFormString(captured.request.body, "description")).toBe(
			"Stocks the player up with 1,000 premium gems.",
		);
	});

	it("should pass through an OpenCloudError when the ocale client returns an error", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockApiError({ message: "boom", statusCode: 500 });

		const result = await driver.create(developerProductDesired());

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.message).toBe("boom");
		expect(result.err.statusCode).toBe(500);
	});
});
