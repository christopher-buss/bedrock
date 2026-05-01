import { ApiError } from "@bedrock/ocale";
import { DeveloperProductsClient } from "@bedrock/ocale/developer-products";
import { createFakeHttpClient, validDeveloperProductBody } from "@bedrock/ocale/testing";

import { developerProductCurrent, developerProductDesired } from "#tests/helpers/resources";
import type { Except } from "type-fest";
import { assert, describe, expect, it, vi } from "vitest";

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

	it("should send isForSale=false in the multipart body when no price is declared", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired({ price: undefined }));

		const captured = http.requests[0]!;

		expect(readFormString(captured.request.body, "isForSale")).toBe("false");

		assert(captured.request.body instanceof FormData);

		expect(captured.request.body.has("price")).toBeFalse();
	});

	it("should send isForSale=true and the declared price when price is set", async () => {
		expect.assertions(2);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired({ price: 250 }));

		const captured = http.requests[0]!;

		expect(readFormString(captured.request.body, "isForSale")).toBe("true");
		expect(readFormString(captured.request.body, "price")).toBe("250");
	});

	it("should attach the icon bytes as imageFile when desired declares an icon", async () => {
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

		await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
			ICON_BYTES,
		);
	});

	it("should omit imageFile from the multipart body when desired has no icon", async () => {
		expect.assertions(1);

		async function readFile(): Promise<Uint8Array> {
			throw new Error("readFile must not run when icon is absent");
		}

		const { driver, http } = makeDriver({ readFile });
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired());

		const captured = http.requests[0]!;
		assert(captured.request.body instanceof FormData);

		expect(captured.request.body.has("imageFile")).toBeFalse();
	});

	it.for([[true], [false]] as const)(
		"should send isRegionalPricingEnabled=%s in the multipart body when it is set on desired",
		async ([flag]) => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: WIRE_BODY, status: 200 });

			await driver.create(developerProductDesired({ isRegionalPricingEnabled: flag }));

			const captured = http.requests[0]!;

			expect(readFormString(captured.request.body, "isRegionalPricingEnabled")).toBe(
				String(flag),
			);
		},
	);

	it("should omit isRegionalPricingEnabled from the body when desired leaves it undefined", async () => {
		expect.assertions(1);

		const { driver, http } = makeDriver();
		http.mockResponse({ body: WIRE_BODY, status: 200 });

		await driver.create(developerProductDesired({ isRegionalPricingEnabled: undefined }));

		const captured = http.requests[0]!;

		assert(captured.request.body instanceof FormData);

		expect(captured.request.body.has("isRegionalPricingEnabled")).toBeFalse();
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

	describe("create follow-up PATCH for storePageEnabled", () => {
		it("should issue a follow-up PATCH carrying storePageEnabled when desired differs from the create response", async () => {
			expect.assertions(4);

			const { driver, http } = makeDriver();
			http.mockResponse({
				body: validDeveloperProductBody({
					productId: 8_172_635_495,
					storePageEnabled: false,
				}),
				status: 200,
			});
			http.mockResponse({ body: undefined, status: 204 });

			await driver.create(developerProductDesired({ storePageEnabled: true }));

			expect(http.requests).toHaveLength(2);

			const post = http.requests[0]!;
			const patch = http.requests[1]!;

			expect(post.request.method).toBe("POST");
			expect(patch.request.method).toBe("PATCH");
			expect(patch.request.url).toBe(
				`/developer-products/v2/universes/${UNIVERSE_ID}/developer-products/${PRODUCT_ID}`,
			);
		});

		it("should send only storePageEnabled in the follow-up PATCH multipart body", async () => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			http.mockResponse({
				body: validDeveloperProductBody({
					productId: 8_172_635_495,
					storePageEnabled: false,
				}),
				status: 200,
			});
			http.mockResponse({ body: undefined, status: 204 });

			await driver.create(developerProductDesired({ storePageEnabled: true }));

			const patch = http.requests[1]!;
			assert(patch.request.body instanceof FormData);

			expect(readFormString(patch.request.body, "storePageEnabled")).toBe("true");
			expect([...patch.request.body.keys()]).toStrictEqual(["storePageEnabled"]);
		});

		it("should compose post-create state with desired.storePageEnabled when the follow-up PATCH succeeds", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			http.mockResponse({
				body: validDeveloperProductBody({
					productId: 8_172_635_495,
					storePageEnabled: false,
				}),
				status: 200,
			});
			http.mockResponse({ body: undefined, status: 204 });

			const desired = developerProductDesired({ storePageEnabled: true });
			const result = await driver.create(desired);

			assert(result.success);

			expect(result.data.storePageEnabled).toBeTrue();
		});

		it("should issue only the create POST when desired.storePageEnabled matches the create response", async () => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			http.mockResponse({
				body: validDeveloperProductBody({
					productId: 8_172_635_495,
					storePageEnabled: true,
				}),
				status: 200,
			});

			await driver.create(developerProductDesired({ storePageEnabled: true }));

			expect(http.requests).toHaveLength(1);
			expect(http.requests[0]!.request.method).toBe("POST");
		});

		it("should issue only the create POST when desired.storePageEnabled is undefined", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			http.mockResponse({ body: WIRE_BODY, status: 200 });

			await driver.create(developerProductDesired({ storePageEnabled: undefined }));

			expect(http.requests).toHaveLength(1);
		});

		it("should return success when the follow-up PATCH fails so the post-create state still persists", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			http.mockResponse({
				body: validDeveloperProductBody({
					productId: 8_172_635_495,
					storePageEnabled: false,
				}),
				status: 200,
			});
			http.mockApiError({ message: "patch boom", statusCode: 403 });

			const result = await driver.create(
				developerProductDesired({ price: 250, storePageEnabled: true }),
			);

			expect(result.success).toBeTrue();
		});

		it("should record the create response storePageEnabled (not desired) so the next deploy's diff retries the PATCH", async () => {
			expect.assertions(2);

			const { driver, http } = makeDriver();
			http.mockResponse({
				body: validDeveloperProductBody({
					productId: 8_172_635_495,
					storePageEnabled: false,
				}),
				status: 200,
			});
			http.mockApiError({ message: "patch boom", statusCode: 403 });

			const result = await driver.create(
				developerProductDesired({ price: 250, storePageEnabled: true }),
			);

			assert(result.success);

			// Wire-reported value, not desired — so fieldsEqual surfaces drift on
			// the next deploy and re-issues the PATCH.
			expect(result.data.storePageEnabled).toBeFalse();
			// Other fields still reflect desired because the POST applied them.
			expect(result.data.price).toBe(250);
		});
	});

	describe("update", () => {
		function mockPatchOk(http: ReturnType<typeof createFakeHttpClient>) {
			http.mockResponse({ body: undefined, status: 204 });
		}

		it("should PATCH the developer-product endpoint with the productId from current outputs", async () => {
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

		it("should re-send name and description on every update", async () => {
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

		it("should send isForSale=true and price when desired.price is defined", async () => {
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

		it("should send isForSale=false and omit price when desired.price is undefined", async () => {
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

		it("should issue exactly one PATCH and no follow-up GET", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver();
			mockPatchOk(http);

			await driver.update!(developerProductCurrent(), developerProductDesired());

			expect(http.requests).toHaveLength(1);
		});

		it("should compose post-update state from the desired entry and the carried-over outputs", async () => {
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

		it("should omit imageFile from the PATCH body when icon hashes match across desired and current", async () => {
			expect.assertions(2);

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
		});

		it("should attach imageFile to the PATCH body when icon hashes drift across desired and current", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver({ readFile: async () => ICON_BYTES });
			mockPatchOk(http);

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

			await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
				ICON_BYTES,
			);
		});

		it("should attach imageFile to the PATCH body when desired adds an icon that current did not record", async () => {
			expect.assertions(1);

			const { driver, http } = makeDriver({ readFile: async () => ICON_BYTES });
			mockPatchOk(http);

			await driver.update!(
				developerProductCurrent(),
				developerProductDesired({
					icon: { "en-us": "assets/gem-pack.png" },
					iconFileHashes: { "en-us": ICON_HASH },
				}),
			);

			const captured = http.requests[0]!;

			await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
				ICON_BYTES,
			);
		});

		it.for([["isRegionalPricingEnabled"], ["storePageEnabled"]] as const)(
			"should send %s in the PATCH body when set on desired",
			async ([flag]) => {
				expect.assertions(2);

				const { driver, http } = makeDriver();
				mockPatchOk(http);

				await driver.update!(
					developerProductCurrent(),
					developerProductDesired({ [flag]: true }),
				);

				const captured = http.requests[0]!;

				expect(readFormString(captured.request.body, flag)).toBe("true");

				assert(captured.request.body instanceof FormData);

				expect(captured.request.body.has(flag)).toBeTrue();
			},
		);

		it.for([["isRegionalPricingEnabled"], ["storePageEnabled"]] as const)(
			"should omit %s from the PATCH body when desired has it undefined",
			async ([flag]) => {
				expect.assertions(1);

				const { driver, http } = makeDriver();
				mockPatchOk(http);

				await driver.update!(
					developerProductCurrent(),
					developerProductDesired({ [flag]: undefined }),
				);

				const captured = http.requests[0]!;

				assert(captured.request.body instanceof FormData);

				expect(captured.request.body.has(flag)).toBeFalse();
			},
		);

		it("should propagate the OpenCloudError when the PATCH fails", async () => {
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
