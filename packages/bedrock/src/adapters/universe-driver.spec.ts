import { ApiError, UnexpectedResponseError } from "@bedrock-rbx/ocale";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import { jsonRequestBody } from "#tests/helpers/http";
import { PLATFORM_FLAG_ROWS, universeCurrent, universeDesired } from "#tests/helpers/resources";
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
			credential: { apiKey: "test-api-key", kind: "apiKey" },
			httpClient: http,
			sleep: async () => {},
		}),
		universes: new UniversesClient({
			credential: { apiKey: "test-api-key", kind: "apiKey" },
			httpClient: http,
			sleep: async () => {},
		}),
	});
	return { driver, http };
}

describe(createUniverseDriver, () => {
	it("should update private-server pricing without requiring another universe field change", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });
		const desired = universeDesired({ privateServerPriceRobux: 250 });
		assert(driver.update !== undefined);
		const result = await driver.update(
			universeCurrent({ ...desired, privateServerPriceRobux: 100 }),
			desired,
		);
		assert(result.success);

		expect(http.requests[0]!.request.method).toBe("PATCH");
		expect(jsonRequestBody(http.requests[0]!.request)).toMatchObject({
			privateServerPriceRobux: 250,
		});
	});

	it("should PATCH the universe endpoint with universeId in the path", async ({ expect }) => {
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

	it("should forward only declared managed fields in the request body", async ({ expect }) => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(universeDesired({ voiceChatEnabled: true }));

		expect(http.requests[0]!.request.body).toStrictEqual({ voiceChatEnabled: true });
	});

	it.for(PLATFORM_FLAG_ROWS)(
		"should forward a declared %s in the request body and updateMask",
		async ([flag], { expect }) => {
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

	it("should forward every declared platform flag plus voiceChatEnabled in body and updateMask", async ({
		expect,
	}) => {
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

	it("should forward privateServerPriceRobux when declared with a numeric value", async ({
		expect,
	}) => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(universeDesired({ privateServerPriceRobux: 250 }));

		expect(http.requests[0]!.request.body).toStrictEqual({
			privateServerPriceRobux: 250,
		});
	});

	it("should emit JSON null for privateServerPriceRobux when declared as undefined", async ({
		expect,
	}) => {
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

	it("should omit privateServerPriceRobux when the desired state does not declare it", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });

		await driver.create(universeDesired({ voiceChatEnabled: false }));

		expect(http.requests[0]!.request.body).not.toHaveProperty("privateServerPriceRobux");
		expect(http.requests[0]!.request.url).not.toContain("privateServerPriceRobux");
	});

	it("should return a current state carrying outputs.rootPlaceId extracted from the response", async ({
		expect,
	}) => {
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

	it("should treat update identically to create", async ({ expect }) => {
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

	it("should omit unchanged managed flags from the universe updateMask on update", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({
			body: validUniverseBody({ rootPlace: ROOT_PLACE_PATH }),
			status: 200,
		});

		assert(driver.update !== undefined);

		await driver.update(
			universeCurrent({ desktopEnabled: true, voiceChatEnabled: false }),
			universeDesired({ desktopEnabled: true, voiceChatEnabled: true }),
		);

		expect(http.requests[0]!.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=voiceChatEnabled`,
		);
		expect(http.requests[0]!.request.body).toStrictEqual({ voiceChatEnabled: true });
	});

	it("should skip the root-place displayName patch when displayName is unchanged on update", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({
			body: validUniverseBody({ rootPlace: ROOT_PLACE_PATH }),
			status: 200,
		});

		assert(driver.update !== undefined);

		await driver.update(
			universeCurrent({ displayName: "Same", voiceChatEnabled: false }),
			universeDesired({ displayName: "Same", voiceChatEnabled: true }),
		);

		expect(http.requests).toHaveLength(1);
		expect(http.requests[0]!.request.url).toBe(
			`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=voiceChatEnabled`,
		);
	});

	it("should surface a 404 as an adoption error naming the config key and universeId", async ({
		expect,
	}) => {
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

	it("should keep the request context when repackaging a 404 as an adoption error", async ({
		expect,
	}) => {
		expect.assertions(4);

		const { driver, http } = makeDriver();
		const original = new ApiError("Not found", {
			elapsedMs: 512,
			method: "GET",
			statusCode: 404,
			url: `https://apis.roblox.com/cloud/v2/universes/${UNIVERSE_ID}`,
		});
		http.mockError(original);

		const result = await driver.create(universeDesired({ voiceChatEnabled: true }));

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.method).toBe("GET");
		expect(result.err.url).toBe(`https://apis.roblox.com/cloud/v2/universes/${UNIVERSE_ID}`);
		expect(result.err.elapsedMs).toBe(512);
		expect(result.err.cause).toBe(original);
	});

	it("should pass through a non-404 OpenCloudError without repackaging", async ({ expect }) => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockApiError({ message: "forbidden", statusCode: 403 });

		const result = await driver.create(universeDesired({ voiceChatEnabled: true }));

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.message).toBe("forbidden");
		expect(result.err.statusCode).toBe(403);
	});

	it("should surface a malformed response with missing rootPlaceId as an UnexpectedResponseError", async ({
		expect,
	}) => {
		expect.assertions(3);

		const { driver, http } = makeDriver();
		http.mockResponse({
			body: validUniverseBody({ rootPlace: undefined }),
			status: 200,
		});

		const result = await driver.create(universeDesired({ voiceChatEnabled: true }));

		assert(!result.success);
		assert(result.err instanceof UnexpectedResponseError);

		expect(result.err.statusCode).toBe(200);
		expect(result.err.message).toMatch(/rootPlaceId missing/);
		expect(result.err.message).toContain(UNIVERSE_ID);
	});

	describe("displayName routing", () => {
		it("should route a declared displayName through the root place after a successful universe patch", async ({
			expect,
		}) => {
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

		it("should fall back to universes.get when only displayName is declared", async ({
			expect,
		}) => {
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

		it("should surface a places.update failure without rolling back the universe patch", async ({
			expect,
		}) => {
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
			async (field, { expect }) => {
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
			async (field, { expect }) => {
				expect.assertions(3);

				// The Open Cloud spec does not mark social links as nullable, but
				// the server accepts null as the clear sentinel. Bypass contract
				// validation so the driver's clear-intent path is observable.
				const { driver, http } = makeDriver({ schemaValidation: "off" });
				http.mockResponse({ body: validUniverseBody(), status: 200 });

				await driver.create(universeDesired({ [field]: undefined }));

				const body = jsonRequestBody(http.requests[0]!.request);

				expect(body).toContainKey(field);
				expect(body[field]).toBeNull();
				expect(http.requests[0]!.request.url).toBe(
					`/cloud/v2/universes/${UNIVERSE_ID}?updateMask=${field}`,
				);
			},
		);

		it.for(SOCIAL_LINK_FIELDS)(
			"should omit %s from the request body and updateMask when the key is absent on desired",
			async (field, { expect }) => {
				expect.assertions(2);

				const { driver, http } = makeDriver();
				http.mockResponse({ body: validUniverseBody(), status: 200 });

				await driver.create(universeDesired({ voiceChatEnabled: true }));

				expect(http.requests[0]!.request.body).not.toContainKey(field);
				expect(http.requests[0]!.request.url).not.toContain(field);
			},
		);

		it("should forward all seven social links plus voiceChatEnabled in one request when all are declared", async ({
			expect,
		}) => {
			expect.assertions(8);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: validUniverseBody(), status: 200 });

			const overrides: Record<string, unknown> = { voiceChatEnabled: true };
			for (const field of SOCIAL_LINK_FIELDS) {
				overrides[field] = { title: `t-${field}`, uri: `https://example.com/${field}` };
			}

			await driver.create(universeDesired(overrides));

			const body = jsonRequestBody(http.requests[0]!.request);
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

describe("visibility transitions", () => {
	it.for([
		["public", "activate"],
		["private", "deactivate"],
	] as const)(
		"should translate %s into its Open Cloud operation",
		async ([visibility, verb], { expect }) => {
			expect.hasAssertions();

			const { driver, http } = makeDriver();
			http.mockResponse({ body: {}, status: 200 });
			const result = await driver.setVisibility!(UNIVERSE_ID, visibility);

			expect(result.success).toBeTrue();
			expect(http.requests[0]!.request.url).toBe(
				`/legacy-develop/v1/universes/${UNIVERSE_ID}/${verb}`,
			);
		},
	);
});

describe("direct universe driver visibility", () => {
	it("should confirm public only after ordinary universe reconciliation", async ({ expect }) => {
		expect.hasAssertions();

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });
		http.mockResponse({ body: {}, status: 200 });
		const result = await driver.create(
			universeDesired({ visibility: "public", voiceChatEnabled: true }),
		);
		assert(result.success);

		expect(result.data.visibility).toBe("public");
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["PATCH", "POST"]);
		expect(http.requests[0]!.request.body).toStrictEqual({ voiceChatEnabled: true });
	});

	it("should confirm private before ordinary universe reconciliation", async ({ expect }) => {
		expect.hasAssertions();

		const { driver, http } = makeDriver();
		http.mockResponse({ body: {}, status: 200 });
		http.mockResponse({ body: validUniverseBody(), status: 200 });
		const result = await driver.create(universeDesired({ visibility: "private" }));
		assert(result.success);

		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["POST", "GET"]);
	});
});

describe("visibility diagnostic forwarding", () => {
	it("should preserve the maturity-rating diagnostic from Ocale", async ({ expect }) => {
		expect.hasAssertions();

		const { driver, http } = makeDriver();
		http.mockError(
			new ApiError("forbidden", {
				code: "3",
				details: { errors: [{ code: 3, message: "forbidden" }] },
				statusCode: 403,
			}),
		);
		const result = await driver.setVisibility!(UNIVERSE_ID, "public");
		assert(!result.success);

		expect(result.err.message).toContain("missing content maturity rating");
	});

	it.for([
		["public", "PUBLIC"],
		["private", "PRIVATE"],
	] as const)(
		"should preserve confirmed 504 verification for %s",
		async ([target, visibility], { expect }) => {
			expect.hasAssertions();

			const { driver, http } = makeDriver();
			http.mockApiError({ statusCode: 504 });
			http.mockResponse({ body: validUniverseBody({ visibility }), status: 200 });
			const result = await driver.setVisibility!(UNIVERSE_ID, target);

			expect(result.success).toBeTrue();
			expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
			]);
		},
	);

	it.for(["PRIVATE", "VISIBILITY_UNSPECIFIED"] as const)(
		"should keep opposite or unspecified visibility %s unconfirmed",
		async (visibility, { expect }) => {
			expect.hasAssertions();

			const { driver, http } = makeDriver();
			const original = new ApiError("timeout", { statusCode: 504 });
			http.mockError(original);
			http.mockResponse({ body: validUniverseBody({ visibility }), status: 200 });
			const result = await driver.setVisibility!(UNIVERSE_ID, "public");
			assert(!result.success);

			expect(result.err).toBe(original);
			expect(http.requests).toHaveLength(2);
		},
	);

	it("should keep an unreadable 504 verification unconfirmed", async ({ expect }) => {
		expect.hasAssertions();

		const { driver, http } = makeDriver();
		const original = new ApiError("timeout", { statusCode: 504 });
		http.mockError(original);
		http.mockApiError({ statusCode: 403 });
		const result = await driver.setVisibility!(UNIVERSE_ID, "public");
		assert(!result.success);

		expect(result.err).toBe(original);
	});
});

describe("direct visibility failure boundaries", () => {
	it("should withhold direct activation when ordinary universe reconciliation fails", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		const failure = new ApiError("universe update refused", { statusCode: 403 });
		http.mockError(failure);
		http.mockResponse({ body: {}, status: 200 });
		const result = await driver.create(
			universeDesired({ visibility: "public", voiceChatEnabled: true }),
		);
		assert(!result.success);

		expect(result.err).toMatchObject({ message: "universe update refused", statusCode: 403 });
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["PATCH"]);
	});

	it("should stop before ordinary reconciliation when direct private fails", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { driver, http } = makeDriver();
		http.mockApiError({ statusCode: 403 });
		const result = await driver.create(universeDesired({ visibility: "private" }));

		expect(result.success).toBeFalse();
		expect(http.requests).toHaveLength(1);
	});

	it("should leave direct public unconfirmed when activation fails", async ({ expect }) => {
		expect.hasAssertions();

		const { driver, http } = makeDriver();
		http.mockResponse({ body: validUniverseBody(), status: 200 });
		http.mockApiError({ statusCode: 403 });
		const result = await driver.create(universeDesired({ visibility: "public" }));

		expect(result.success).toBeFalse();
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["GET", "POST"]);
	});
});
