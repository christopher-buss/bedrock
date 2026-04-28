import { ApiError } from "@bedrock/ocale";
import { GamePassesClient } from "@bedrock/ocale/game-passes";
import { createFakeHttpClient, validGamePassBody } from "@bedrock/ocale/testing";

import { gamePassDesired } from "#tests/helpers/resources";
import type { Except } from "type-fest";
import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId } from "../types/ids.ts";
import { createGamePassDriver, type GamePassDriverDeps } from "./game-pass-driver.ts";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const WIRE_BODY = validGamePassBody({
	name: "VIP Pass",
	description: "Grants VIP perks.",
	gamePassId: 9_876_543_210,
	iconAssetId: 1_122_334_455,
	priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
});

function makeDriver(overrides?: Partial<Except<GamePassDriverDeps, "client">>) {
	const http = createFakeHttpClient();
	const driver = createGamePassDriver({
		client: new GamePassesClient({
			apiKey: "test-api-key",
			httpClient: http,
			sleep: async () => {},
		}),
		readFile: async () => ICON_BYTES,
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

async function readFormBytes(body: unknown, key: string): Promise<Uint8Array> {
	assert(body instanceof FormData);
	const value = body.get(key);
	assert(value instanceof Blob);
	return new Uint8Array(await value.arrayBuffer());
}

describe(createGamePassDriver, () => {
	it("should compose current state by merging desired fields with Roblox-assigned outputs", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		const desired = gamePassDesired();
		const result = await driver.create(desired);

		assert(result.success);

		expect(result.data).toStrictEqual({
			...desired,
			outputs: {
				assetId: "9876543210",
				iconAssetIds: { "en-us": "1122334455" },
			},
		});
	});

	it("should POST to the Open Cloud create-game-pass endpoint for the configured universe", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(gamePassDesired());

		const captured = http.requests[0]!;

		expect(captured.request.method).toBe("POST");
		expect(captured.request.url).toBe(`/game-passes/v1/universes/${UNIVERSE_ID}/game-passes`);
	});

	it("should send name, description, price, and icon bytes in the multipart body", async () => {
		expect.assertions(4);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(gamePassDesired());

		const captured = http.requests[0]!;

		expect(readFormString(captured.request.body, "name")).toBe("VIP Pass");
		expect(readFormString(captured.request.body, "description")).toBe("Grants VIP perks.");
		expect(readFormString(captured.request.body, "price")).toBe("500");
		await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
			ICON_BYTES,
		);
	});

	it("should omit the price field from the request when desired price is undefined", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(gamePassDesired({ price: undefined }));

		const captured = http.requests[0]!;
		assert(captured.request.body instanceof FormData);

		expect(captured.request.body.has("price")).toBeFalse();
	});

	it("should pass through an OpenCloudError when the ocale client returns an error", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockApiError({ message: "boom", statusCode: 500 });

		const result = await driver.create(gamePassDesired());

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.message).toBe("boom");
		expect(result.err.statusCode).toBe(500);
	});

	it("should return an ApiError when the response is missing an iconAssetId", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({
			body: { ...WIRE_BODY, iconAssetId: 0 },
			status: 200,
		});

		const result = await driver.create(gamePassDesired());

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe(
			"Malformed game pass response: iconAssetId missing after icon upload",
		);
	});

	it("should read the icon bytes from the en-us locale path declared on desired state", async () => {
		expect.assertions(1);

		const http = createFakeHttpClient();
		http.mockResponse({ body: WIRE_BODY, status: 200 });
		const seenPaths: Array<string> = [];
		const driver = createGamePassDriver({
			client: new GamePassesClient({
				apiKey: "test-api-key",
				httpClient: http,
				sleep: async () => {},
			}),
			readFile: async (path) => {
				seenPaths.push(path);
				return ICON_BYTES;
			},
			universeId: UNIVERSE_ID,
		});

		await driver.create(gamePassDesired({ icon: { "en-us": "assets/locale-aware.png" } }));

		expect(seenPaths).toStrictEqual(["assets/locale-aware.png"]);
	});

	it("should propagate readFile rejections without calling ocale", async () => {
		expect.assertions(2);

		const fsError = new Error("ENOENT: no such file or directory");
		const http = createFakeHttpClient();
		const driver = createGamePassDriver({
			client: new GamePassesClient({
				apiKey: "test-api-key",
				httpClient: http,
				sleep: async () => {},
			}),
			readFile: async () => {
				throw fsError;
			},
			universeId: UNIVERSE_ID,
		});

		await expect(driver.create(gamePassDesired())).rejects.toBe(fsError);
		expect(http.requests).toBeEmpty();
	});
});
