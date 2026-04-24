import { ApiError } from "@bedrock/ocale";
import { createFakeHttpClient, validUniverseBody } from "@bedrock/ocale/testing";
import { UniversesClient } from "@bedrock/ocale/universes";

import { universeDesired } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { UNIVERSE_SINGLETON_KEY } from "../core/resources.ts";
import { createUniverseDriver } from "./universe-driver.ts";

const UNIVERSE_ID = "1234567890";

function makeDriver() {
	const http = createFakeHttpClient();
	const driver = createUniverseDriver({
		client: new UniversesClient({
			apiKey: "test-api-key",
			httpClient: http,
			sleep: async () => {},
		}),
	});
	return { driver, http };
}

describe(createUniverseDriver, () => {
	it("should PATCH the universe endpoint with universeId in the path", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(universeDesired({ voiceChatEnabled: true }));

		const captured = http.requests[0]!;

		expect(captured.request.method).toBe("PATCH");
		expect(captured.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=voiceChatEnabled`,
		);
	});

	it("should forward only declared managed fields in the request body", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(universeDesired({ voiceChatEnabled: true }));

		expect(http.requests[0]!.request.body).toStrictEqual({ voiceChatEnabled: true });
	});

	it("should return a current state carrying outputs.rootPlaceId extracted from the response", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({
			body: validUniverseBody({
				path: `universes/${UNIVERSE_ID}`,
				rootPlace: `universes/${UNIVERSE_ID}/places/4711`,
			}),
			status: 200,
		});

		const desired = universeDesired({ voiceChatEnabled: true });
		const result = await driver.create(desired);

		assert(result.success);

		expect(result.data).toStrictEqual({
			...desired,
			outputs: { rootPlaceId: "4711" },
		});
	});

	it("should treat update identically to create", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({
			body: validUniverseBody({
				path: `universes/${UNIVERSE_ID}`,
				rootPlace: `universes/${UNIVERSE_ID}/places/4711`,
			}),
			status: 200,
		});

		assert(driver.update !== undefined);

		const desired = universeDesired({ voiceChatEnabled: true });
		const result = await driver.update(
			{ ...desired, outputs: { rootPlaceId: desired.universeId } },
			desired,
		);

		assert(result.success);

		expect(result.data.outputs.rootPlaceId).toBe("4711");
	});

	it("should surface a 404 as an adoption error naming the config key and universeId", async () => {
		expect.assertions(4);

		const { driver, http } = makeDriver();
		http.mockApiError({ message: "Not found", statusCode: 404 });

		const desired = universeDesired({ voiceChatEnabled: true });
		const result = await driver.create(desired);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.statusCode).toBe(404);
		expect(result.err.message).toContain(UNIVERSE_ID);
		expect(result.err.message).toContain(UNIVERSE_SINGLETON_KEY);
		expect(result.err.message).toMatch(/adoption/i);
	});

	it("should pass through a non-404 OpenCloudError without repackaging", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockApiError({ message: "forbidden", statusCode: 403 });

		const result = await driver.create(universeDesired({ voiceChatEnabled: true }));

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.message).toBe("forbidden");
		expect(result.err.statusCode).toBe(403);
	});

	it("should surface a malformed response with missing rootPlaceId as an ApiError", async () => {
		expect.assertions(3);

		const { driver, http } = makeDriver();
		http.mockResponse({
			body: validUniverseBody({ rootPlace: undefined }),
			status: 200,
		});

		const result = await driver.create(universeDesired({ voiceChatEnabled: true }));

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.statusCode).toBe(200);
		expect(result.err.message).toMatch(/rootPlaceId missing/);
		expect(result.err.message).toContain(UNIVERSE_ID);
	});
});
