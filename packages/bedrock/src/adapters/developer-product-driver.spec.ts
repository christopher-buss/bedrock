import { ApiError } from "@bedrock-rbx/ocale";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { createFakeHttpClient, validDeveloperProductBody } from "@bedrock-rbx/ocale/testing";

import type { Except } from "type-fest";
import { assert, describe, it, vi } from "vitest";

import { developerProductCurrent, developerProductDesired } from "#tests/helpers/resources";
import { asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import {
	createDeveloperProductDriver,
	type DeveloperProductDriverDeps,
} from "./developer-product-driver.ts";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const PRODUCT_ID = asRobloxAssetId("8172635495");
const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
const ALT_ICON_HASH = asSha256Hex(
	"a3f2c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852e1b0",
);

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
			credential: { apiKey: "test-api-key", kind: "apiKey" },
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

async function readFormBytesAsync(body: unknown, key: string): Promise<Uint8Array> {
	assert(body instanceof FormData);
	const value = body.get(key);
	assert(value instanceof Blob);
	return new Uint8Array(await value.arrayBuffer());
}

describe(createDeveloperProductDriver, () => {
	it.for(["create", "update"] as const)(
		"should preserve Roblox InvalidManagedPricing message on %s",
		async (operation, { expect }) => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			const message = "Managed pricing must be accepted before it can be enabled.";
			http.mockApiError({ code: "InvalidManagedPricing", message, statusCode: 400 });
			const desired = developerProductDesired({ isManagedPricingEnabled: true, price: 100 });
			const actions = {
				create: async () => driver.create(desired),
				update: async () => driver.update!(developerProductCurrent(), desired),
			};
			const result = await actions[operation]();
			assert(!result.success && result.err instanceof ApiError);

			expect(result.err.message).toBe(message);
			expect(result.err.code).toBe("InvalidManagedPricing");
		},
	);

	it.for([true, false])(
		"should retain Roblox managed-pricing read-back %s after create",
		async (isManagedPricingEnabled, { expect }) => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: { ...WIRE_BODY, isManagedPricingEnabled }, status: 200 });
			const result = await driver.create(
				developerProductDesired({ isManagedPricingEnabled: !isManagedPricingEnabled }),
			);
			assert(result.success);

			expect(result.data.isManagedPricingEnabled).toBe(isManagedPricingEnabled);
		},
	);

	it.for([
		[{ isManagedPricingEnabled: true }, "true"],
		[{ isManagedPricingEnabled: false }, "false"],
		[{}, "false"],
	] as const)(
		"should send managed pricing %s on developer product create and update",
		async ([fields, expected], { expect }) => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			const desired = developerProductDesired(fields);
			http.mockResponse({ body: WIRE_BODY, status: 200 });
			await driver.create(desired);

			expect(readFormString(http.requests[0]!.request.body, "isManagedPricingEnabled")).toBe(
				expected,
			);

			http.mockResponse({ status: 204 });
			await driver.update!(developerProductCurrent(), desired);

			expect(readFormString(http.requests[1]!.request.body, "isManagedPricingEnabled")).toBe(
				expected,
			);
		},
	);

	it("should compose current state by merging desired fields with Roblox-assigned outputs", async ({
		expect,
	}) => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		const desired = developerProductDesired();
		const result = await driver.create(desired);

		assert(result.success);

		expect(result.data).toStrictEqual({
			...desired,
			isManagedPricingEnabled: false,
			outputs: {
				iconImageAssetId: "1122334455",
				productId: "8172635495",
			},
		});
	});

	it("should omit iconImageAssetId from the outputs key set when the response carries no icon", async ({
		expect,
	}) => {
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

	it("should POST to the Open Cloud create-developer-product endpoint for the configured universe", async ({
		expect,
	}) => {
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

	it("should send name and description in the multipart body", async ({ expect }) => {
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

	it("should send isForSale=false in the multipart body when no price is declared", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired({ price: undefined }));

		const captured = http.requests[0]!;

		expect(readFormString(captured.request.body, "isForSale")).toBe("false");

		assert(captured.request.body instanceof FormData);

		expect(captured.request.body.has("price")).toBeFalse();
	});

	it("should send isForSale=true and the declared price when price is set", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired({ price: 250 }));

		const captured = http.requests[0]!;

		expect(readFormString(captured.request.body, "isForSale")).toBe("true");
		expect(readFormString(captured.request.body, "price")).toBe("250");
	});

	it("should attach the icon bytes as imageFile when desired declares an icon", async ({
		expect,
	}) => {
		expect.assertions(1);

		const { driver, http } = makeDriver({ readFile: async () => ICON_BYTES });
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(
			developerProductDesired({
				icon: { "en-us": "assets/gem-pack.png" },
				iconFileHashes: { "en-us": ICON_HASH },
			}),
		);

		const captured = http.requests[0]!;

		await expect(readFormBytesAsync(captured.request.body, "imageFile")).resolves.toStrictEqual(
			ICON_BYTES,
		);
	});

	it("should omit imageFile from the multipart body when desired has no icon", async ({
		expect,
	}) => {
		expect.assertions(1);

		async function readFileAsync(): Promise<Uint8Array> {
			throw new Error("readFile must not run when icon is absent");
		}

		const { driver, http } = makeDriver({ readFile: readFileAsync });
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired());

		const captured = http.requests[0]!;
		assert(captured.request.body instanceof FormData);

		expect(captured.request.body.has("imageFile")).toBeFalse();
	});

	it("should pass through an OpenCloudError when the ocale client returns an error", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockApiError({ message: "boom", statusCode: 500 });

		const result = await driver.create(developerProductDesired());

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.message).toBe("boom");
		expect(result.err.statusCode).toBe(500);
	});

	it("should create with a single POST that carries neither retired pricing nor store-page field", async ({
		expect,
	}) => {
		expect.assertions(3);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired({ price: 250 }));

		expect(http.requests).toHaveLength(1);

		const { body } = http.requests[0]!.request;
		assert(body instanceof FormData);

		expect(body.has("isRegionalPricingEnabled")).toBeFalse();
		expect(body.has("storePageEnabled")).toBeFalse();
	});

	describe("update", () => {
		function mockPatchOk(http: ReturnType<typeof createFakeHttpClient>) {
			http.mockResponse({ body: undefined, status: 204 });
		}

		it("should PATCH the developer-product endpoint with the productId from current outputs", async ({
			expect,
		}) => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			mockPatchOk(http);

			await driver.update!(
				developerProductCurrent({ outputs: { productId: PRODUCT_ID } }),
				developerProductDesired(),
			);

			const captured = http.requests[0]!;

			expect(captured.request.method).toBe("PATCH");
			expect(captured.request.url).toBe(
				`/developer-products/v2/universes/${UNIVERSE_ID}/developer-products/${PRODUCT_ID}`,
			);
		});

		it("should re-send name and description on every update", async ({ expect }) => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			mockPatchOk(http);

			await driver.update!(
				developerProductCurrent(),
				developerProductDesired({
					name: "Mega Gem Pack",
					description: "Stocks the player up with 5,000 premium gems.",
				}),
			);

			const captured = http.requests[0]!;

			expect(readFormString(captured.request.body, "name")).toBe("Mega Gem Pack");
			expect(readFormString(captured.request.body, "description")).toBe(
				"Stocks the player up with 5,000 premium gems.",
			);
		});

		it("should send isForSale=true and price when desired.price is defined", async ({
			expect,
		}) => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			mockPatchOk(http);

			await driver.update!(
				developerProductCurrent({ price: undefined }),
				developerProductDesired({ price: 250 }),
			);

			const captured = http.requests[0]!;

			expect(readFormString(captured.request.body, "isForSale")).toBe("true");
			expect(readFormString(captured.request.body, "price")).toBe("250");
		});

		it("should send isForSale=false and omit price when desired.price is undefined", async ({
			expect,
		}) => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			mockPatchOk(http);

			await driver.update!(
				developerProductCurrent({ price: 100 }),
				developerProductDesired({ price: undefined }),
			);

			const captured = http.requests[0]!;

			expect(readFormString(captured.request.body, "isForSale")).toBe("false");

			assert(captured.request.body instanceof FormData);

			expect(captured.request.body.has("price")).toBeFalse();
		});

		it("should issue exactly one PATCH and no follow-up GET when no icon is declared", async ({
			expect,
		}) => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			mockPatchOk(http);

			await driver.update!(developerProductCurrent(), developerProductDesired());

			expect(http.requests).toHaveLength(1);
		});

		it("should compose post-update state from the desired entry and the carried-over outputs", async ({
			expect,
		}) => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			mockPatchOk(http);

			const carriedOutputs = {
				iconImageAssetId: asRobloxAssetId("1122334455"),
				productId: PRODUCT_ID,
			};
			const desired = developerProductDesired({ price: 250 });
			const result = await driver.update!(
				developerProductCurrent({ outputs: carriedOutputs }),
				desired,
			);

			assert(result.success);

			expect(result.data).toStrictEqual({ ...desired, outputs: carriedOutputs });
		});

		it("should omit imageFile from the PATCH body when icon hashes match across desired and current", async ({
			expect,
		}) => {
			expect.assertions(3);

			const readFile = vi.fn<DeveloperProductDriverDeps["readFile"]>(async () => ICON_BYTES);
			const { driver, http } = makeDriver({ readFile });
			mockPatchOk(http);

			const desired = developerProductDesired({
				icon: { "en-us": "assets/gem-pack.png" },
				iconFileHashes: { "en-us": ICON_HASH },
			});
			await driver.update!(
				developerProductCurrent({
					icon: { "en-us": "assets/gem-pack.png" },
					iconFileHashes: { "en-us": ICON_HASH },
				}),
				desired,
			);

			const captured = http.requests[0]!;
			assert(captured.request.body instanceof FormData);

			expect(captured.request.body.has("imageFile")).toBeFalse();
			expect(readFile).not.toHaveBeenCalled();
			expect(http.requests).toHaveLength(1);
		});

		it("should attach imageFile to the PATCH body when icon hashes drift across desired and current", async ({
			expect,
		}) => {
			expect.assertions(1);

			const { driver, http } = makeDriver({ readFile: async () => ICON_BYTES });
			mockPatchOk(http);
			http.mockResponse({ body: WIRE_BODY, status: 200 });

			await driver.update!(
				developerProductCurrent({
					icon: { "en-us": "assets/gem-pack.png" },
					iconFileHashes: { "en-us": ALT_ICON_HASH },
				}),
				developerProductDesired({
					icon: { "en-us": "assets/gem-pack.png" },
					iconFileHashes: { "en-us": ICON_HASH },
				}),
			);

			const captured = http.requests[0]!;

			await expect(
				readFormBytesAsync(captured.request.body, "imageFile"),
			).resolves.toStrictEqual(ICON_BYTES);
		});

		it("should attach imageFile to the PATCH body when desired adds an icon that current did not record", async ({
			expect,
		}) => {
			expect.assertions(1);

			const { driver, http } = makeDriver({ readFile: async () => ICON_BYTES });
			mockPatchOk(http);
			http.mockResponse({ body: WIRE_BODY, status: 200 });

			await driver.update!(
				developerProductCurrent(),
				developerProductDesired({
					icon: { "en-us": "assets/gem-pack.png" },
					iconFileHashes: { "en-us": ICON_HASH },
				}),
			);

			const captured = http.requests[0]!;

			await expect(
				readFormBytesAsync(captured.request.body, "imageFile"),
			).resolves.toStrictEqual(ICON_BYTES);
		});

		it.for([["isRegionalPricingEnabled"], ["storePageEnabled"]] as const)(
			"should leave the retired %s field out of the PATCH body",
			async ([field], { expect }) => {
				expect.assertions(1);

				const { driver, http } = makeDriver();
				mockPatchOk(http);

				await driver.update!(developerProductCurrent(), developerProductDesired());

				const { body } = http.requests[0]!.request;
				assert(body instanceof FormData);

				expect(body.has(field)).toBeFalse();
			},
		);

		function driftedIconPair() {
			return {
				current: developerProductCurrent({
					icon: { "en-us": "assets/gem-pack.png" },
					iconFileHashes: { "en-us": ALT_ICON_HASH },
					outputs: {
						iconImageAssetId: asRobloxAssetId("1111111111"),
						productId: PRODUCT_ID,
					},
				}),
				desired: developerProductDesired({
					icon: { "en-us": "assets/gem-pack.png" },
					iconFileHashes: { "en-us": ICON_HASH },
				}),
			};
		}

		it("should read back the new iconImageAssetId with a GET after an icon re-upload", async ({
			expect,
		}) => {
			expect.assertions(4);

			const { driver, http } = makeDriver();
			mockPatchOk(http);
			http.mockResponse({
				body: { ...WIRE_BODY, iconImageAssetId: 9_988_776_655 },
				status: 200,
			});

			const { current, desired } = driftedIconPair();
			const result = await driver.update!(current, desired);
			assert(result.success);

			expect(http.requests).toHaveLength(2);
			expect(http.requests[1]!.request.method).toBe("GET");
			expect(http.requests[1]!.request.url).toBe(
				`/developer-products/v2/universes/${UNIVERSE_ID}/developer-products/${PRODUCT_ID}/creator`,
			);
			expect(result.data).toStrictEqual({
				...desired,
				isManagedPricingEnabled: WIRE_BODY.isManagedPricingEnabled,
				outputs: { iconImageAssetId: asRobloxAssetId("9988776655"), productId: PRODUCT_ID },
			});
		});

		it("should propagate the OpenCloudError when the follow-up GET fails", async ({
			expect,
		}) => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			mockPatchOk(http);
			http.mockApiError({ message: "gone", statusCode: 404 });

			const { current, desired } = driftedIconPair();
			const result = await driver.update!(current, desired);

			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err.message).toBe("gone");
			expect(result.err.statusCode).toBe(404);
		});

		it("should propagate the OpenCloudError when the PATCH fails", async ({ expect }) => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			http.mockApiError({ message: "not found", statusCode: 404 });

			const result = await driver.update!(
				developerProductCurrent(),
				developerProductDesired(),
			);

			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err.message).toBe("not found");
			expect(result.err.statusCode).toBe(404);
		});
	});
});
