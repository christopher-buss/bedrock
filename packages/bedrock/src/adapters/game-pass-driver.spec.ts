import { ApiError } from "@bedrock-rbx/ocale";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { createFakeHttpClient, validGamePassBody } from "@bedrock-rbx/ocale/testing";

import { gamePassCurrent, gamePassDesired } from "#tests/helpers/resources";
import type { Except } from "type-fest";
import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { createGamePassDriver, type GamePassDriverDeps } from "./game-pass-driver.ts";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const NEW_ICON_HASH = asSha256Hex(
	"a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
);

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

	describe("update", () => {
		it("should PATCH the per-game-pass endpoint with the configured universe and prior asset id", async () => {
			expect.assertions(3);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: undefined, status: 204 });

			const current = gamePassCurrent();
			const desired = gamePassDesired({ name: "Updated VIP" });

			assert(driver.update !== undefined);
			await driver.update(current, desired);

			const captured = http.requests[0]!;

			expect(captured.request.method).toBe("PATCH");
			expect(captured.request.url).toBe(
				`/game-passes/v1/universes/${UNIVERSE_ID}/game-passes/${current.outputs.assetId}`,
			);
			expect(http.requests).toHaveLength(1);
		});

		it("should serialize updated name, description, price, and isForSale=true into the multipart body", async () => {
			expect.assertions(4);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: undefined, status: 204 });

			const current = gamePassCurrent();
			const desired = gamePassDesired({
				name: "Updated VIP",
				description: "Better perks.",
				price: 750,
			});

			assert(driver.update !== undefined);
			await driver.update(current, desired);

			const captured = http.requests[0]!;

			expect(readFormString(captured.request.body, "name")).toBe("Updated VIP");
			expect(readFormString(captured.request.body, "description")).toBe("Better perks.");
			expect(readFormString(captured.request.body, "price")).toBe("750");
			expect(readFormString(captured.request.body, "isForSale")).toBe("true");
		});

		it("should omit the icon file from the body when iconFileHash matches", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: undefined, status: 204 });

			const current = gamePassCurrent();
			const desired = gamePassDesired({ name: "Updated VIP" });

			assert(driver.update !== undefined);
			await driver.update(current, desired);

			const captured = http.requests[0]!;
			assert(captured.request.body instanceof FormData);

			expect(captured.request.body.has("file")).toBeFalse();
		});

		it("should not call readFile when iconFileHash matches", async () => {
			expect.assertions(1);

			const http = createFakeHttpClient();
			http.mockResponse({ body: undefined, status: 204 });
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

			const current = gamePassCurrent();
			const desired = gamePassDesired({ name: "Updated VIP" });

			assert(driver.update !== undefined);
			await driver.update(current, desired);

			expect(seenPaths).toBeEmpty();
		});

		it("should compose updated current state by merging desired with the prior outputs", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: undefined, status: 204 });

			const current = gamePassCurrent();
			const desired = gamePassDesired({
				name: "Updated VIP",
				description: "Better perks.",
				price: 750,
			});

			assert(driver.update !== undefined);
			const result = await driver.update(current, desired);

			assert(result.success);

			expect(result.data).toStrictEqual({
				...desired,
				outputs: current.outputs,
			});
		});

		it("should mark the pass off-sale and omit price when desired price is undefined", async () => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: undefined, status: 204 });

			const current = gamePassCurrent();
			const desired = gamePassDesired({ price: undefined });

			assert(driver.update !== undefined);
			await driver.update(current, desired);

			const captured = http.requests[0]!;
			assert(captured.request.body instanceof FormData);

			expect(captured.request.body.has("price")).toBeFalse();
			expect(readFormString(captured.request.body, "isForSale")).toBe("false");
		});

		it("should pass through an OpenCloudError when the ocale client returns an error", async () => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			http.mockApiError({ message: "boom", statusCode: 400 });

			assert(driver.update !== undefined);
			const result = await driver.update(gamePassCurrent(), gamePassDesired());

			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err.message).toBe("boom");
			expect(result.err.statusCode).toBe(400);
		});

		it("should not call the read endpoint when iconFileHash matches", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: undefined, status: 204 });

			const current = gamePassCurrent();
			const desired = gamePassDesired({ name: "Updated VIP" });

			assert(driver.update !== undefined);
			await driver.update(current, desired);

			expect(http.requests).toHaveLength(1);
		});

		it("should re-upload the icon file in the multipart body when iconFileHash differs", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: undefined, status: 204 });
			http.mockResponse({ body: WIRE_BODY, status: 200 });

			const current = gamePassCurrent();
			const desired = gamePassDesired({
				icon: { "en-us": "assets/new-icon.png" },
				iconFileHashes: { "en-us": NEW_ICON_HASH },
			});

			assert(driver.update !== undefined);
			await driver.update(current, desired);

			const captured = http.requests[0]!;

			await expect(readFormBytes(captured.request.body, "file")).resolves.toStrictEqual(
				ICON_BYTES,
			);
		});

		it("should read icon bytes from the en-us locale path when iconFileHash differs", async () => {
			expect.assertions(1);

			const http = createFakeHttpClient();
			http.mockResponse({ body: undefined, status: 204 });
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

			const current = gamePassCurrent();
			const desired = gamePassDesired({
				icon: { "en-us": "assets/refreshed-icon.png" },
				iconFileHashes: { "en-us": NEW_ICON_HASH },
			});

			assert(driver.update !== undefined);
			await driver.update(current, desired);

			expect(seenPaths).toStrictEqual(["assets/refreshed-icon.png"]);
		});

		it("should follow a successful icon-change PATCH with a get to refresh the assigned icon asset id", async () => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: undefined, status: 204 });
			http.mockResponse({
				body: { ...WIRE_BODY, iconAssetId: 5_555_555_555 },
				status: 200,
			});

			const current = gamePassCurrent();
			const desired = gamePassDesired({
				icon: { "en-us": "assets/new-icon.png" },
				iconFileHashes: { "en-us": NEW_ICON_HASH },
			});

			assert(driver.update !== undefined);
			const result = await driver.update(current, desired);

			assert(result.success);

			expect(http.requests[1]?.request.method).toBe("GET");
			expect(result.data.outputs.iconAssetIds["en-us"]).toBe("5555555555");
		});

		it("should pass through an OpenCloudError from the post-update get", async () => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: undefined, status: 204 });
			http.mockApiError({ message: "lookup boom", statusCode: 404 });

			const current = gamePassCurrent();
			const desired = gamePassDesired({
				icon: { "en-us": "assets/new-icon.png" },
				iconFileHashes: { "en-us": NEW_ICON_HASH },
			});

			assert(driver.update !== undefined);
			const result = await driver.update(current, desired);

			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err.message).toBe("lookup boom");
			expect(result.err.statusCode).toBe(404);
		});

		it("should propagate readFile rejections without calling ocale on icon-change updates", async () => {
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

			const current = gamePassCurrent();
			const desired = gamePassDesired({
				icon: { "en-us": "assets/new-icon.png" },
				iconFileHashes: { "en-us": NEW_ICON_HASH },
			});

			assert(driver.update !== undefined);

			await expect(driver.update(current, desired)).rejects.toBe(fsError);
			expect(http.requests).toBeEmpty();
		});
	});
});
