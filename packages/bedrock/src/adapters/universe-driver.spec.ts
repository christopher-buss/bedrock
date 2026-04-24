import { ApiError } from "@bedrock/ocale";
import { PlacesClient } from "@bedrock/ocale/places";
import { createFakeHttpClient, validPlaceBody, validUniverseBody } from "@bedrock/ocale/testing";
import { UniversesClient } from "@bedrock/ocale/universes";

import { PLATFORM_FLAG_ROWS, universeDesired } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { SOCIAL_LINK_FIELDS, UNIVERSE_SINGLETON_KEY } from "../core/resources.ts";
import { createUniverseDriver } from "./universe-driver.ts";

const UNIVERSE_ID = "1234567890";
const ROOT_PLACE_ID = "4711";
const ROOT_PLACE_PATH = `universes/${UNIVERSE_ID}/places/${ROOT_PLACE_ID}`;

interface MakeDriverOptions {
	readonly schemaValidation?: "off" | "strict" | "warn";
}

function makeDriver(options: MakeDriverOptions = {}) {
	const http = createFakeHttpClient({
		schemaValidation: options.schemaValidation ?? "strict",
	});
	const driver = createUniverseDriver({
		places: new PlacesClient({
			apiKey: "test-api-key",
			httpClient: http,
			sleep: async () => {},
		}),
		universes: new UniversesClient({
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

	it.for(PLATFORM_FLAG_ROWS)(
		"should forward a declared %s in the request body and updateMask",
		async ([flag]) => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: validUniverseBody(), status: 200 });

			await driver.create(universeDesired({ [flag]: false }));

			expect(http.requests[0]!.request.body).toStrictEqual({ [flag]: false });
			expect(http.requests[0]!.request.url).toBe(
				`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=${flag}`,
			);
		},
	);

	it("should forward every declared platform flag plus voiceChatEnabled in body and updateMask", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(
			universeDesired({
				consoleEnabled: true,
				desktopEnabled: true,
				mobileEnabled: false,
				tabletEnabled: true,
				voiceChatEnabled: false,
				vrEnabled: true,
			}),
		);

		expect(http.requests[0]!.request.body).toStrictEqual({
			consoleEnabled: true,
			desktopEnabled: true,
			mobileEnabled: false,
			tabletEnabled: true,
			voiceChatEnabled: false,
			vrEnabled: true,
		});
		expect(http.requests[0]!.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=desktopEnabled,mobileEnabled,tabletEnabled,consoleEnabled,vrEnabled,voiceChatEnabled`,
		);
	});

	it("should translate visibility into the PATCH body and mask when declared", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(universeDesired({ visibility: "public" }));

		expect(http.requests[0]!.request.body).toStrictEqual({ visibility: "PUBLIC" });
		expect(http.requests[0]!.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=visibility`,
		);
	});

	it("should forward privateServerPriceRobux when declared with a numeric value", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(universeDesired({ privateServerPriceRobux: 250 }));

		expect(http.requests[0]!.request.body).toStrictEqual({
			privateServerPriceRobux: 250,
		});
	});

	it("should emit JSON null for privateServerPriceRobux when declared as undefined", async () => {
		expect.assertions(1);

		// Roblox's OpenAPI spec omits `nullable: true` on
		// `privateServerPriceRobux` even though the description documents
		// null as the "clear" sentinel; the strict contract check enforces
		// the declared integer type, so this scenario opts out to exercise
		// the runtime-accepted null emission.
		const { driver, http } = makeDriver({ schemaValidation: "off" });
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(universeDesired({ privateServerPriceRobux: undefined }));

		expect(http.requests[0]!.request.body).toStrictEqual({
			privateServerPriceRobux: JSON.parse("null"),
		});
	});

	it("should omit privateServerPriceRobux when the desired state does not declare it", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(universeDesired({ voiceChatEnabled: false }));

		expect(http.requests[0]!.request.body).not.toHaveProperty("privateServerPriceRobux");
		expect(http.requests[0]!.request.url).not.toContain("privateServerPriceRobux");
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

	describe("displayName routing", () => {
		it("should route a declared displayName through the root place after a successful universe patch", async () => {
			expect.assertions(4);

			const { driver, http } = makeDriver();
			http.mockResponse({
				body: validUniverseBody({
					path: `universes/${UNIVERSE_ID}`,
					rootPlace: ROOT_PLACE_PATH,
				}),
				status: 200,
			});
			http.mockResponse({
				body: validPlaceBody({
					displayName: "Fun Universe",
					path: ROOT_PLACE_PATH,
				}),
				status: 200,
			});

			const result = await driver.create(
				universeDesired({ displayName: "Fun Universe", voiceChatEnabled: true }),
			);

			assert(result.success);

			expect(http.requests).toHaveLength(2);
			expect(http.requests[0]!.request.method).toBe("PATCH");
			expect(http.requests[1]!.request.url).toBe(
				`/cloud/v2/universes/${UNIVERSE_ID}/places/${ROOT_PLACE_ID}?updateMask=displayName`,
			);
			expect(http.requests[1]!.request.body).toStrictEqual({
				displayName: "Fun Universe",
			});
		});

		it("should fall back to universes.get when only displayName is declared", async () => {
			expect.assertions(4);

			const { driver, http } = makeDriver();
			http.mockResponse({
				body: validUniverseBody({
					path: `universes/${UNIVERSE_ID}`,
					rootPlace: ROOT_PLACE_PATH,
				}),
				status: 200,
			});
			http.mockResponse({
				body: validPlaceBody({
					displayName: "Fun Universe",
					path: ROOT_PLACE_PATH,
				}),
				status: 200,
			});

			const result = await driver.create(universeDesired({ displayName: "Fun Universe" }));

			assert(result.success);

			expect(http.requests).toHaveLength(2);
			expect(http.requests[0]!.request.method).toBe("GET");
			expect(http.requests[0]!.request.url).toBe(`/cloud/v2/universes/${UNIVERSE_ID}`);
			expect(http.requests[1]!.request.url).toBe(
				`/cloud/v2/universes/${UNIVERSE_ID}/places/${ROOT_PLACE_ID}?updateMask=displayName`,
			);
		});

		it("should surface a places.update failure without rolling back the universe patch", async () => {
			expect.assertions(3);

			const { driver, http } = makeDriver();
			http.mockResponse({
				body: validUniverseBody({
					path: `universes/${UNIVERSE_ID}`,
					rootPlace: ROOT_PLACE_PATH,
				}),
				status: 200,
			});
			http.mockApiError({ message: "forbidden", statusCode: 403 });

			const result = await driver.create(
				universeDesired({ displayName: "Fun Universe", voiceChatEnabled: true }),
			);

			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err.statusCode).toBe(403);
			expect(http.requests).toHaveLength(2);
			expect(http.requests[0]!.request.method).toBe("PATCH");
		});
	});

	describe("social links", () => {
		it.for(SOCIAL_LINK_FIELDS)(
			"should forward %s with its declared SocialLink value into the request body and updateMask",
			async (field) => {
				expect.assertions(2);

				const { driver, http } = makeDriver();
				http.mockResponse({ body: validUniverseBody(), status: 200 });

				const value = { title: `t-${field}`, uri: `https://example.com/${field}` };
				await driver.create(universeDesired({ [field]: value }));

				expect(http.requests[0]!.request.body).toStrictEqual({ [field]: value });
				expect(http.requests[0]!.request.url).toBe(
					`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=${field}`,
				);
			},
		);

		it.for(SOCIAL_LINK_FIELDS)(
			"should emit JSON null in the request body for %s when declared as undefined and include it in the updateMask",
			async (field) => {
				expect.assertions(3);

				// The Open Cloud spec does not mark social links as nullable, but
				// the server accepts null as the clear sentinel. Bypass contract
				// validation so the driver's clear-intent path is observable.
				const { driver, http } = makeDriver({ schemaValidation: "off" });
				http.mockResponse({ body: validUniverseBody(), status: 200 });

				await driver.create(universeDesired({ [field]: undefined }));

				const body = http.requests[0]!.request.body as Record<string, unknown>;

				expect(body).toContainKey(field);
				expect(body[field]).toBeNull();
				expect(http.requests[0]!.request.url).toBe(
					`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=${field}`,
				);
			},
		);

		it.for(SOCIAL_LINK_FIELDS)(
			"should omit %s from the request body and updateMask when the key is absent on desired",
			async (field) => {
				expect.assertions(2);

				const { driver, http } = makeDriver();
				http.mockResponse({ body: validUniverseBody(), status: 200 });

				await driver.create(universeDesired({ voiceChatEnabled: true }));

				expect(http.requests[0]!.request.body).not.toContainKey(field);
				expect(http.requests[0]!.request.url).not.toContain(field);
			},
		);

		it("should forward all seven social links plus voiceChatEnabled in one request when all are declared", async () => {
			expect.assertions(8);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: validUniverseBody(), status: 200 });

			const overrides: Record<string, unknown> = { voiceChatEnabled: true };
			for (const field of SOCIAL_LINK_FIELDS) {
				overrides[field] = { title: `t-${field}`, uri: `https://example.com/${field}` };
			}

			await driver.create(universeDesired(overrides));

			const body = http.requests[0]!.request.body as Record<string, unknown>;
			for (const field of SOCIAL_LINK_FIELDS) {
				expect(body[field]).toStrictEqual({
					title: `t-${field}`,
					uri: `https://example.com/${field}`,
				});
			}

			expect(body).toContainEntry(["voiceChatEnabled", true]);
		});
	});
});
