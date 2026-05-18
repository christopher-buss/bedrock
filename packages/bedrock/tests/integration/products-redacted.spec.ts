import {
	applyOps,
	asRobloxAssetId,
	buildDesired,
	createDeveloperProductDriver,
	defineConfig,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	type ResourceCurrentState,
	type ResourceDesiredState,
	type ResourceDriver,
	selectEnvironment,
	UNIVERSE_SINGLETON_KEY,
	validatePlan,
} from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { createFakeHttpClient, validDeveloperProductBody } from "@bedrock-rbx/ocale/testing";

import {
	defaultRedactedProductName,
	REDACTED_DESCRIPTION,
	REDACTED_PRICE,
} from "#src/core/redact-resources";
import { REDACTED_ICON_BYTES, REDACTED_ICON_PATH } from "#src/core/redacted-icon";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PRODUCTS_FIXTURE_DIR = join(FIXTURES_ROOT, "products-redacted");
const PRODUCTS_ENV_FIXTURE_DIR = join(FIXTURES_ROOT, "products-redacted-env");
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const ROOT_PLACE_ID = asRobloxAssetId("4711");

const GAME_PASS_TRAP: ResourceDriver<"gamePass"> = {
	create() {
		throw new Error("GamePassDriver.create must not run for redacted-product fixtures");
	},
};

const PLACE_TRAP: ResourceDriver<"place"> = {
	create() {
		throw new Error("PlaceDriver.create must not run for redacted-product fixtures");
	},
};

const UNIVERSE_ADOPTED: ResourceCurrentState<"universe"> = {
	key: UNIVERSE_SINGLETON_KEY,
	consoleEnabled: undefined,
	desktopEnabled: undefined,
	displayName: undefined,
	kind: "universe",
	mobileEnabled: undefined,
	outputs: { rootPlaceId: ROOT_PLACE_ID },
	tabletEnabled: undefined,
	universeId: UNIVERSE_ID,
	voiceChatEnabled: undefined,
	vrEnabled: undefined,
};

const UNIVERSE_DRIVER: ResourceDriver<"universe"> = {
	async create() {
		return { data: UNIVERSE_ADOPTED, success: true };
	},
};

const UNIVERSE_TRAP: ResourceDriver<"universe"> = {
	create() {
		throw new Error(
			"UniverseDriver.create must not run when current state already adopts the universe",
		);
	},
};

const REAL_ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);

async function panicOnRealPath(path: string): Promise<Uint8Array> {
	throw new Error(`readFile must not run for path: ${path}`);
}

async function readRealIcon(path: string): Promise<Uint8Array> {
	if (path === "assets/gems.png") {
		return REAL_ICON_BYTES;
	}

	throw new Error(`readFile must not run for path: ${path}`);
}

async function readFormBytes(body: unknown, key: string): Promise<Uint8Array> {
	assert(body instanceof FormData);
	const value = body.get(key);
	assert(value instanceof Blob);
	return new Uint8Array(await value.arrayBuffer());
}

function readFormString(body: unknown, key: string): string {
	assert(body instanceof FormData);
	const value = body.get(key);
	assert(typeof value === "string");
	return value;
}

function findProductDesired(
	desired: ReadonlyArray<ResourceDesiredState>,
	key: string,
): Extract<ResourceDesiredState, { readonly kind: "developerProduct" }> {
	const entry = desired.find((value) => value.kind === "developerProduct" && value.key === key);
	assert(entry?.kind === "developerProduct");
	return entry;
}

function persistedProduct(
	desired: Extract<ResourceDesiredState, { readonly kind: "developerProduct" }>,
	overrides: Partial<ResourceCurrentState<"developerProduct">> = {},
): ResourceCurrentState<"developerProduct"> {
	return {
		...desired,
		outputs: { productId: asRobloxAssetId("8172635495") },
		...overrides,
	};
}

describe("products-redacted pipeline end-to-end", () => {
	it("should upload placeholder name, description, embedded icon bytes, and the placeholder price when redacted is true", async () => {
		expect.assertions(5);

		const loaded = await loadConfig({ cwd: PRODUCTS_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const readFile = panicOnRealPath;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const expectedName = defaultRedactedProductName("gem-pack");
		const httpClient = createFakeHttpClient().mockResponse({
			body: validDeveloperProductBody({
				name: expectedName,
				description: REDACTED_DESCRIPTION,
				productId: 8_172_635_495,
				universeId: 1_234_567_890,
			}),
			status: 200,
		});

		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);
		assert(applyResult.success);

		const captured = httpClient.requests[0]!;

		expect(readFormString(captured.request.body, "name")).toBe(expectedName);
		expect(readFormString(captured.request.body, "description")).toBe(REDACTED_DESCRIPTION);
		expect(readFormString(captured.request.body, "price")).toBe(String(REDACTED_PRICE));
		await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
			REDACTED_ICON_BYTES,
		);

		const created = applyResult.data.find((entry) => entry.kind === "developerProduct");
		assert(created !== undefined);

		expect(created.name).toBe(expectedName);
	});

	it("should upload the price override and default placeholders when redacted is an object with price", async () => {
		expect.assertions(2);

		const config = defineConfig({
			environments: { production: {} },
			products: {
				"gem-pack": {
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					icon: { "en-us": "assets/gems.png" },
					price: 1500,
					redacted: { price: 500 },
				},
			},
			universe: { universeId: "1234567890" },
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const readFile = panicOnRealPath;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const expectedName = defaultRedactedProductName("gem-pack");
		const httpClient = createFakeHttpClient().mockResponse({
			body: validDeveloperProductBody({
				name: expectedName,
				description: REDACTED_DESCRIPTION,
				productId: 8_172_635_495,
				universeId: 1_234_567_890,
			}),
			status: 200,
		});

		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);
		assert(applyResult.success);

		const captured = httpClient.requests[0]!;

		expect(readFormString(captured.request.body, "price")).toBe("500");
		expect(readFormString(captured.request.body, "name")).toBe(expectedName);
	});

	it("should keep an off-sale product off-sale on the wire when redacted is true", async () => {
		expect.assertions(2);

		const config = defineConfig({
			environments: { production: {} },
			products: {
				"soon-pack": {
					name: "Coming Soon Pack",
					description: "Reveal at launch.",
					icon: { "en-us": "assets/gems.png" },
					redacted: true,
				},
			},
			universe: { universeId: "1234567890" },
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const readFile = panicOnRealPath;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const expectedName = defaultRedactedProductName("soon-pack");
		const httpClient = createFakeHttpClient().mockResponse({
			body: validDeveloperProductBody({
				name: expectedName,
				description: REDACTED_DESCRIPTION,
				productId: 8_172_635_495,
				universeId: 1_234_567_890,
			}),
			status: 200,
		});

		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);
		assert(applyResult.success);

		const captured = httpClient.requests[0]!;
		assert(captured.request.body instanceof FormData);

		expect(captured.request.body.has("price")).toBeFalse();
		expect(readFormString(captured.request.body, "name")).toBe(expectedName);
	});

	it("should re-deploy as a noop when the persisted state already carries the placeholder values", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: PRODUCTS_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const readFile = panicOnRealPath;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient();
		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_TRAP,
		};

		const gemPack = findProductDesired(desiredResult.data, "gem-pack");
		const ops = diff(desiredResult.data, [persistedProduct(gemPack), UNIVERSE_ADOPTED]);

		expect(ops.every((op) => op.type === "noop")).toBeTrue();

		const applyResult = await applyOps(ops, registry);
		assert(applyResult.success);

		expect(httpClient.requests).toBeEmpty();
	});

	it("should treat a config-side name edit as a noop while redacted stays true", async () => {
		expect.assertions(1);

		const config = defineConfig({
			environments: { production: {} },
			products: {
				"gem-pack": {
					name: "Gem Pack v2",
					description: "Edited copy that must not ship.",
					icon: { "en-us": "assets/gems.png" },
					price: 100,
					redacted: true,
				},
			},
			universe: { universeId: "1234567890" },
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const readFile = panicOnRealPath;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const gemPack = findProductDesired(desiredResult.data, "gem-pack");
		const ops = diff(desiredResult.data, [persistedProduct(gemPack), UNIVERSE_ADOPTED]);

		expect(ops.every((op) => op.type === "noop")).toBeTrue();
	});

	it("should upload the icon override bytes and default name and description when redacted is an object with icon", async () => {
		expect.assertions(3);

		const overrideIconPath = "assets/closed-beta.png";
		const overrideIconBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xaa, 0xbb, 0xcc]);

		const config = defineConfig({
			environments: { production: {} },
			products: {
				"gem-pack": {
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					icon: { "en-us": "assets/gems.png" },
					price: 100,
					redacted: { icon: { "en-us": overrideIconPath } },
				},
			},
			universe: { universeId: "1234567890" },
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		async function readOverrideIcon(path: string): Promise<Uint8Array> {
			if (path === overrideIconPath) {
				return overrideIconBytes;
			}

			throw new Error(`readFile must not run for path: ${path}`);
		}

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readOverrideIcon);
		assert(desiredResult.success);

		const expectedName = defaultRedactedProductName("gem-pack");
		const httpClient = createFakeHttpClient().mockResponse({
			body: validDeveloperProductBody({
				name: expectedName,
				description: REDACTED_DESCRIPTION,
				productId: 8_172_635_495,
				universeId: 1_234_567_890,
			}),
			status: 200,
		});

		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile: readOverrideIcon,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);
		assert(applyResult.success);

		const captured = httpClient.requests[0]!;

		expect(readFormString(captured.request.body, "name")).toBe(expectedName);
		expect(readFormString(captured.request.body, "description")).toBe(REDACTED_DESCRIPTION);
		await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
			overrideIconBytes,
		);
	});

	it("should upload the name override and default placeholders when redacted is an object with name", async () => {
		expect.assertions(3);

		const config = defineConfig({
			environments: { production: {} },
			products: {
				"gem-pack": {
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					icon: { "en-us": "assets/gems.png" },
					price: 100,
					redacted: { name: "Closed Beta Pack" },
				},
			},
			universe: { universeId: "1234567890" },
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const readFile = panicOnRealPath;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient().mockResponse({
			body: validDeveloperProductBody({
				name: "Closed Beta Pack",
				description: REDACTED_DESCRIPTION,
				productId: 8_172_635_495,
				universeId: 1_234_567_890,
			}),
			status: 200,
		});

		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);
		assert(applyResult.success);

		const captured = httpClient.requests[0]!;

		expect(readFormString(captured.request.body, "name")).toBe("Closed Beta Pack");
		expect(readFormString(captured.request.body, "description")).toBe(REDACTED_DESCRIPTION);
		await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
			REDACTED_ICON_BYTES,
		);
	});

	it("should push real values on the next deploy when redacted flips from true to false", async () => {
		expect.assertions(3);

		const config = defineConfig({
			environments: { production: {} },
			products: {
				"gem-pack": {
					name: "Gem Pack",
					description: "Stocks the player up with 1,000 premium gems.",
					icon: { "en-us": "assets/gems.png" },
					price: 100,
					redacted: false,
				},
			},
			universe: { universeId: "1234567890" },
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const readFile = readRealIcon;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient().mockResponse({
			body: undefined,
			status: 204,
		});

		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_TRAP,
		};

		const gemPack = findProductDesired(desiredResult.data, "gem-pack");
		const placeholderHash = await hashPlaceholderIcon();
		const prior = persistedProduct(gemPack, {
			name: defaultRedactedProductName("gem-pack"),
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			iconFileHashes: { "en-us": placeholderHash },
		});

		expect(gemPack.icon?.["en-us"]).toBe("assets/gems.png");

		const ops = diff(desiredResult.data, [prior, UNIVERSE_ADOPTED]);
		const nonNoop = ops.filter((op) => op.type !== "noop");

		expect(nonNoop.map((op) => op.type)).toStrictEqual(["update"]);

		const applyResult = await applyOps(ops, registry);
		assert(applyResult.success);

		const captured = httpClient.requests[0]!;

		await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
			REAL_ICON_BYTES,
		);
	});

	it("should give two redacted products distinct wire names so Roblox does not reject the second create as DuplicateProductName", async () => {
		expect.assertions(3);

		const config = defineConfig({
			environments: { production: { redacted: true } },
			products: {
				"bp-1": {
					name: "Release Pass",
					description: "Buy the season pass.",
				},
				"gems-2": {
					name: "1,250 Gems",
					description: "Buy 1,250 gems.",
				},
			},
			universe: { universeId: "1234567890" },
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const readFile = panicOnRealPath;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const planCheck = validatePlan(desiredResult.data, []);
		assert(planCheck.success);

		const bpName = defaultRedactedProductName("bp-1");
		const gemsName = defaultRedactedProductName("gems-2");

		expect(bpName).not.toBe(gemsName);

		const httpClient = createFakeHttpClient()
			.mockResponse({
				body: validDeveloperProductBody({
					name: bpName,
					description: REDACTED_DESCRIPTION,
					productId: 1_111_111_111,
					universeId: 1_234_567_890,
				}),
				status: 200,
			})
			.mockResponse({
				body: validDeveloperProductBody({
					name: gemsName,
					description: REDACTED_DESCRIPTION,
					productId: 2_222_222_222,
					universeId: 1_234_567_890,
				}),
				status: 200,
			});

		const registry: DriverRegistry = {
			developerProduct: createDeveloperProductDriver({
				client: new DeveloperProductsClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);
		assert(applyResult.success);

		const nameForms = httpClient.requests
			.filter((entry) => entry.request.method === "POST")
			.map((entry) => readFormString(entry.request.body, "name"));

		expect(nameForms).toIncludeSameMembers([bpName, gemsName]);

		const createdNames = applyResult.data
			.filter((entry) => entry.kind === "developerProduct")
			.map((entry) => entry.name);

		expect(createdNames).toIncludeSameMembers([bpName, gemsName]);
	});

	it("should reject the plan when two redacted products would resolve to the same wire name via override", async () => {
		expect.assertions(3);

		const config = defineConfig({
			environments: { production: { redacted: true } },
			products: {
				"bp-1": {
					name: "Release Pass",
					description: "Buy the season pass.",
					redacted: { name: "Hidden" },
				},
				"bp-2": {
					name: "Other Pass",
					description: "Buy the other pass.",
					redacted: { name: "Hidden" },
				},
			},
			universe: { universeId: "1234567890" },
		});

		const resolved = selectEnvironment(config, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), panicOnRealPath);
		assert(desiredResult.success);

		const planCheck = validatePlan(desiredResult.data, []);
		assert(!planCheck.success);
		assert(planCheck.err.kind === "redactedNameCollision");

		expect(planCheck.err.resolvedName).toBe("Hidden");
		expect(planCheck.err.keys).toIncludeSameMembers(["bp-1", "bp-2"]);
		expect(planCheck.err.message).toContain("Hidden");
	});
});

describe("products-redacted env-level toggle", () => {
	it("should redact a product with no redacted flag when the env-level redacted toggle is true", async () => {
		expect.assertions(3);

		const loaded = await loadConfig({ cwd: PRODUCTS_ENV_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "dev");
		assert(resolved.success);

		const gemPack = resolved.data.products?.["gem-pack"];
		assert(gemPack !== undefined);

		expect(gemPack.name).toBe(defaultRedactedProductName("gem-pack"));
		expect(gemPack.description).toBe(REDACTED_DESCRIPTION);
		expect(gemPack.icon?.["en-us"]).toBe(REDACTED_ICON_PATH);
	});

	it("should leave a product real when its overlay sets redacted false despite an env-level redacted true", async () => {
		expect.assertions(3);

		const loaded = await loadConfig({ cwd: PRODUCTS_ENV_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "dev");
		assert(resolved.success);

		const carve = resolved.data.products?.["carve-out-pack"];
		assert(carve !== undefined);

		expect(carve.name).toBe("Carve Out");
		expect(carve.description).toBe("Stays real in dev.");
		expect(carve.icon?.["en-us"]).toBe("assets/carve.png");
	});

	it("should not redact products in an env whose redacted toggle is absent", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: PRODUCTS_ENV_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const gemPack = resolved.data.products?.["gem-pack"];
		const carve = resolved.data.products?.["carve-out-pack"];

		expect(gemPack?.name).toBe("Gem Pack");
		expect(carve?.name).toBe("Carve Out");
	});
});

async function hashPlaceholderIcon(): Promise<
	NonNullable<ResourceCurrentState<"developerProduct">["iconFileHashes"]>["en-us"]
> {
	const probe = defineConfig({
		environments: { production: {} },
		products: {
			probe: {
				name: "probe",
				description: "probe",
				icon: { "en-us": "assets/gems.png" },
				redacted: true,
			},
		},
	});
	const resolved = selectEnvironment(probe, "production");
	assert(resolved.success);
	const desired = await buildDesired(flattenConfig(resolved.data), panicOnRealPath);
	assert(desired.success);
	const entry = findProductDesired(desired.data, "probe");
	assert(entry.iconFileHashes !== undefined);
	return entry.iconFileHashes["en-us"];
}
