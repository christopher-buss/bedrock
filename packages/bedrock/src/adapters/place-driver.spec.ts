import { ApiError } from "@bedrock/ocale";
import { PlacesClient } from "@bedrock/ocale/places";
import { createFakeHttpClient } from "@bedrock/ocale/testing";

import { placeCurrent, placeDesired } from "#tests/helpers/resources";
import type { Except } from "type-fest";
import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId } from "../types/ids.ts";
import { createPlaceDriver, type PlaceDriverDeps } from "./place-driver.ts";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const PLACE_ID = asRobloxAssetId("4711");
const RBXL_SIGNATURE = new Uint8Array([
	0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x21, 0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const RBXLX_SIGNATURE = new Uint8Array([0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x20]);

function makeDriver(overrides?: Partial<Except<PlaceDriverDeps, "client">>) {
	const http = createFakeHttpClient();
	const driver = createPlaceDriver({
		client: new PlacesClient({
			apiKey: "test-api-key",
			httpClient: http,
			sleep: async () => {},
		}),
		readFile: async () => RBXL_SIGNATURE,
		universeId: UNIVERSE_ID,
		...overrides,
	});
	return { driver, http };
}

describe(createPlaceDriver, () => {
	it("should publish an rbxl place and return a PlaceOutputs-shaped current state", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 3 }, status: 200 });

		const desired = placeDesired();
		const result = await driver.create(desired);

		assert(result.success);

		expect(result.data).toStrictEqual({
			...desired,
			outputs: { versionNumber: 3 },
		});
	});

	it("should POST to the place publish endpoint with content-type application/octet-stream for rbxl", async () => {
		expect.assertions(3);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 1 }, status: 200 });

		await driver.create(placeDesired());

		const captured = http.requests[0]!;

		expect(captured.request.method).toBe("POST");
		expect(captured.request.url).toBe(
			`/universes/v1/${UNIVERSE_ID}/places/${PLACE_ID}/versions?versionType=Published`,
		);
		expect(captured.request.headers?.["content-type"]).toBe("application/octet-stream");
	});

	it("should detect rbxlx from the filename and send application/xml", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver({ readFile: async () => RBXLX_SIGNATURE });
		http.mockResponse({ body: { versionNumber: 1 }, status: 200 });

		await driver.create(placeDesired({ filePath: "places/start.rbxlx" }));

		expect(http.requests[0]!.request.headers?.["content-type"]).toBe("application/xml");
	});

	it("should return an ApiError for unsupported file extensions without hitting the network", async () => {
		expect.assertions(3);

		const { driver, http } = makeDriver();

		const result = await driver.create(placeDesired({ filePath: "places/start.txt" }));

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toMatch(/Unsupported place file extension/);
		expect(http.requests).toBeEmpty();
	});

	it("should pass through an OpenCloudError when the ocale client returns an error", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockApiError({ message: "boom", statusCode: 500 });

		const result = await driver.create(placeDesired());

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.message).toBe("boom");
		expect(result.err.statusCode).toBe(500);
	});

	it("should propagate readFile rejections without calling ocale", async () => {
		expect.assertions(2);

		const fsError = new Error("ENOENT: no such file or directory");
		const { driver, http } = makeDriver({
			readFile: async () => {
				throw fsError;
			},
		});

		await expect(driver.create(placeDesired())).rejects.toBe(fsError);
		expect(http.requests).toBeEmpty();
	});

	it("should treat update identically to create for a file-backed publish", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 7 }, status: 200 });

		assert(driver.update !== undefined);

		const desired = placeDesired();
		const result = await driver.update(placeCurrent({ ...desired }), desired);

		assert(result.success);

		expect(result.data.outputs.versionNumber).toBe(7);
		expect(http.requests).toHaveLength(1);
	});
});
