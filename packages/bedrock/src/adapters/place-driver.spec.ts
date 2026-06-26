import { ApiError } from "@bedrock-rbx/ocale";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import { createFakeHttpClient, validPlaceBody } from "@bedrock-rbx/ocale/testing";

import { placeCurrent, placeDesired } from "#tests/helpers/resources";
import type { Except } from "type-fest";
import { assert, describe, expect, it, vi } from "vitest";

import { asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
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
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 3 }, status: 200 });

		const desired = placeDesired();
		const result = await driver.create(desired);

		assert(result.success);

		expect(result.data).toStrictEqual({
			...desired,
			outputs: { versionNumber: 3 },
		});
		expect(http.requests).toHaveLength(1);
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

	it("should issue a PATCH with displayName only after publish when only displayName is declared", async () => {
		expect.assertions(4);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 1 }, status: 200 });
		http.mockResponse({
			body: validPlaceBody({ displayName: "Lobby" }),
			status: 200,
		});

		const result = await driver.create(placeDesired({ displayName: "Lobby" }));

		assert(result.success);

		expect(http.requests).toHaveLength(2);
		expect(http.requests[1]!.request.method).toBe("PATCH");
		expect(http.requests[1]!.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}/places/${PLACE_ID}?updateMask=displayName`,
		);
		expect(http.requests[1]!.request.body).toStrictEqual({ displayName: "Lobby" });
	});

	it("should forward every declared metadata field in the PATCH body and updateMask", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 1 }, status: 200 });
		http.mockResponse({
			body: validPlaceBody({
				description: "Updated body.",
				displayName: "Lobby v2",
				serverSize: 25,
			}),
			status: 200,
		});

		assert(driver.update !== undefined);

		await driver.update(
			placeCurrent(),
			placeDesired({
				description: "Updated body.",
				displayName: "Lobby v2",
				serverSize: 25,
			}),
		);

		expect(http.requests[1]!.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}/places/${PLACE_ID}?updateMask=displayName,description,serverSize`,
		);
		expect(http.requests[1]!.request.body).toStrictEqual({
			description: "Updated body.",
			displayName: "Lobby v2",
			serverSize: 25,
		});
	});

	it("should still PATCH metadata when only description differs and the file hash is unchanged", async () => {
		expect.assertions(3);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 2 }, status: 200 });
		http.mockResponse({
			body: validPlaceBody({ description: "Updated body." }),
			status: 200,
		});

		assert(driver.update !== undefined);

		await driver.update(placeCurrent(), placeDesired({ description: "Updated body." }));

		expect(http.requests).toHaveLength(2);
		expect(http.requests[1]!.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}/places/${PLACE_ID}?updateMask=description`,
		);
		expect(http.requests[1]!.request.body).toStrictEqual({ description: "Updated body." });
	});

	it("should skip the metadata PATCH on update when only the file hash changed", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 4 }, status: 200 });

		assert(driver.update !== undefined);

		const current = placeCurrent({
			description: "Body.",
			displayName: "Lobby",
			fileHash: asSha256Hex(
				"0000000000000000000000000000000000000000000000000000000000000000",
			),
			serverSize: 25,
		});
		const result = await driver.update(
			current,
			placeDesired({ description: "Body.", displayName: "Lobby", serverSize: 25 }),
		);

		assert(result.success);

		expect(http.requests).toHaveLength(1);
		expect(http.requests[0]!.request.method).toBe("POST");
	});

	it("should omit unchanged metadata fields from the updateMask on update", async () => {
		expect.assertions(3);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 5 }, status: 200 });
		http.mockResponse({
			body: validPlaceBody({ description: "New body." }),
			status: 200,
		});

		assert(driver.update !== undefined);

		const current = placeCurrent({
			description: "Old body.",
			displayName: "Lobby",
			serverSize: 25,
		});
		await driver.update(
			current,
			placeDesired({ description: "New body.", displayName: "Lobby", serverSize: 25 }),
		);

		expect(http.requests).toHaveLength(2);
		expect(http.requests[1]!.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}/places/${PLACE_ID}?updateMask=description`,
		);
		expect(http.requests[1]!.request.body).toStrictEqual({ description: "New body." });
	});

	it("should surface a Result.err when the metadata PATCH fails after a successful publish", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: { versionNumber: 1 }, status: 200 });
		http.mockApiError({
			code: "INVALID_ARGUMENT",
			message: "displayName too long",
			statusCode: 400,
		});

		const result = await driver.create(placeDesired({ displayName: "X" }));

		assert(!result.success);

		expect(http.requests).toHaveLength(2);
		expect(result.err.message).toContain("displayName too long");
	});

	it("should publish the supplied artifact bytes instead of reading the file on create", async () => {
		expect.assertions(2);

		const rebuilt = Uint8Array.from([...RBXL_SIGNATURE, 0xaa, 0xbb]);
		const { driver, http } = makeDriver({
			readFile: async () => {
				throw new Error("readFile must not run when an artifact is supplied");
			},
		});
		http.mockResponse({ body: { versionNumber: 4 }, status: 200 });

		const result = await driver.create(placeDesired(), { artifact: rebuilt });

		assert(result.success);

		expect(result.data.outputs.versionNumber).toBe(4);
		expect(http.requests[0]!.request.body).toStrictEqual(Uint8Array.from(rebuilt));
	});

	it("should publish the supplied artifact bytes instead of reading the file on update", async () => {
		expect.assertions(1);

		const rebuilt = Uint8Array.from([...RBXL_SIGNATURE, 0xcc]);
		const { driver, http } = makeDriver({
			readFile: async () => {
				throw new Error("readFile must not run when an artifact is supplied");
			},
		});
		http.mockResponse({ body: { versionNumber: 7 }, status: 200 });

		assert(driver.update !== undefined);

		await driver.update(placeCurrent(), placeDesired(), { artifact: rebuilt });

		expect(http.requests[0]!.request.body).toStrictEqual(Uint8Array.from(rebuilt));
	});

	it("should fall back to reading the file when no artifact context is supplied", async () => {
		expect.assertions(2);

		const fromDisk = Uint8Array.from([...RBXL_SIGNATURE, 0x99]);
		const readFile = vi.fn<PlaceDriverDeps["readFile"]>().mockResolvedValue(fromDisk);
		const { driver, http } = makeDriver({ readFile });
		http.mockResponse({ body: { versionNumber: 1 }, status: 200 });

		await driver.create(placeDesired());

		expect(readFile).toHaveBeenCalledExactlyOnceWith("places/start.rbxl");
		expect(http.requests[0]!.request.body).toStrictEqual(Uint8Array.from(fromDisk));
	});
});
