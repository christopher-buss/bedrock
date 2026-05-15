import {
	applyOps,
	asRobloxAssetId,
	buildDesired,
	createGamePassDriver,
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
} from "@bedrock-rbx/core";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { createFakeHttpClient, validGamePassBody } from "@bedrock-rbx/ocale/testing";

import { REDACTED_DESCRIPTION, REDACTED_PASS_NAME } from "#src/core/redact-resources";
import { REDACTED_ICON_BYTES, REDACTED_ICON_PATH } from "#src/core/redacted-icon";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PASSES_FIXTURE_DIR = join(FIXTURES_ROOT, "passes-redacted");
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const ROOT_PLACE_ID = asRobloxAssetId("4711");

const DEVELOPER_PRODUCT_TRAP: ResourceDriver<"developerProduct"> = {
	create() {
		throw new Error("DeveloperProductDriver.create must not run for redacted-pass fixtures");
	},
};

const PLACE_TRAP: ResourceDriver<"place"> = {
	create() {
		throw new Error("PlaceDriver.create must not run for redacted-pass fixtures");
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
	if (path === "assets/vip.png") {
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

function findGamePassDesired(
	desired: ReadonlyArray<ResourceDesiredState>,
): Extract<ResourceDesiredState, { readonly kind: "gamePass" }> {
	const entry = desired.find((value) => value.kind === "gamePass");
	assert(entry !== undefined);
	return entry;
}

function persistedPass(
	desired: ReadonlyArray<ResourceDesiredState>,
	overrides: Partial<ResourceCurrentState<"gamePass">> = {},
): ResourceCurrentState<"gamePass"> {
	return {
		...findGamePassDesired(desired),
		outputs: {
			assetId: asRobloxAssetId("9876543210"),
			iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
		},
		...overrides,
	};
}

describe("passes-redacted pipeline end-to-end", () => {
	it("should upload placeholder name, description, and embedded icon bytes when redacted is true", async () => {
		expect.assertions(4);

		const loaded = await loadConfig({ cwd: PASSES_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const readFile = panicOnRealPath;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient().mockResponse({
			body: validGamePassBody({
				name: REDACTED_PASS_NAME,
				description: REDACTED_DESCRIPTION,
				gamePassId: 9_876_543_210,
				iconAssetId: 1_122_334_455,
			}),
			status: 200,
		});

		const registry: DriverRegistry = {
			developerProduct: DEVELOPER_PRODUCT_TRAP,
			gamePass: createGamePassDriver({
				client: new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);
		assert(applyResult.success);

		const captured = httpClient.requests[0]!;

		expect(readFormString(captured.request.body, "name")).toBe(REDACTED_PASS_NAME);
		expect(readFormString(captured.request.body, "description")).toBe(REDACTED_DESCRIPTION);
		await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
			REDACTED_ICON_BYTES,
		);

		const created = applyResult.data.find((entry) => entry.kind === "gamePass");
		assert(created !== undefined);

		expect(created.name).toBe(REDACTED_PASS_NAME);
	});

	it("should re-deploy as a noop when the persisted state already carries the placeholder values", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: PASSES_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const readFile = panicOnRealPath;
		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFile);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient();
		const registry: DriverRegistry = {
			developerProduct: DEVELOPER_PRODUCT_TRAP,
			gamePass: createGamePassDriver({
				client: new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			place: PLACE_TRAP,
			universe: UNIVERSE_TRAP,
		};

		const ops = diff(desiredResult.data, [persistedPass(desiredResult.data), UNIVERSE_ADOPTED]);

		expect(ops.every((op) => op.type === "noop")).toBeTrue();

		const applyResult = await applyOps(ops, registry);
		assert(applyResult.success);

		expect(httpClient.requests).toBeEmpty();
	});

	it("should treat a config-side name edit as a noop while redacted stays true", async () => {
		expect.assertions(1);

		const config = defineConfig({
			environments: { production: {} },
			passes: {
				"vip-pass": {
					name: "VIP Pass v2",
					description: "Edited copy that must not ship.",
					icon: { "en-us": "assets/vip.png" },
					price: 500,
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

		const ops = diff(desiredResult.data, [persistedPass(desiredResult.data), UNIVERSE_ADOPTED]);

		expect(ops.every((op) => op.type === "noop")).toBeTrue();
	});

	it("should upload the name override and default placeholders when redacted is an object with name", async () => {
		expect.assertions(3);

		const config = defineConfig({
			environments: { production: {} },
			passes: {
				"vip-pass": {
					name: "VIP Pass",
					description: "Grants VIP perks.",
					icon: { "en-us": "assets/vip.png" },
					price: 500,
					redacted: { name: "Closed Beta" },
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
			body: validGamePassBody({
				name: "Closed Beta",
				description: REDACTED_DESCRIPTION,
				gamePassId: 9_876_543_210,
				iconAssetId: 1_122_334_455,
			}),
			status: 200,
		});

		const registry: DriverRegistry = {
			developerProduct: DEVELOPER_PRODUCT_TRAP,
			gamePass: createGamePassDriver({
				client: new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			place: PLACE_TRAP,
			universe: UNIVERSE_DRIVER,
		};

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);
		assert(applyResult.success);

		const captured = httpClient.requests[0]!;

		expect(readFormString(captured.request.body, "name")).toBe("Closed Beta");
		expect(readFormString(captured.request.body, "description")).toBe(REDACTED_DESCRIPTION);
		await expect(readFormBytes(captured.request.body, "imageFile")).resolves.toStrictEqual(
			REDACTED_ICON_BYTES,
		);
	});

	it("should push real values on the next deploy when redacted flips from true to false", async () => {
		expect.assertions(3);

		const config = defineConfig({
			environments: { production: {} },
			passes: {
				"vip-pass": {
					name: "VIP Pass",
					description: "Grants VIP perks.",
					icon: { "en-us": "assets/vip.png" },
					price: 500,
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

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: undefined, status: 204 })
			.mockResponse({
				body: validGamePassBody({
					name: "VIP Pass",
					description: "Grants VIP perks.",
					gamePassId: 9_876_543_210,
					iconAssetId: 2_233_445_566,
				}),
				status: 200,
			});
		const registry: DriverRegistry = {
			developerProduct: DEVELOPER_PRODUCT_TRAP,
			gamePass: createGamePassDriver({
				client: new GamePassesClient({
					apiKey: "test-key",
					httpClient,
					sleep: async () => {},
				}),
				readFile,
				universeId: UNIVERSE_ID,
			}),
			place: PLACE_TRAP,
			universe: UNIVERSE_TRAP,
		};

		const desiredPass = findGamePassDesired(desiredResult.data);
		const placeholderHash = await hashPlaceholderIcon(readFile);
		const prior = persistedPass(desiredResult.data, {
			name: REDACTED_PASS_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			iconFileHashes: { "en-us": placeholderHash },
		});

		expect(desiredPass.icon["en-us"]).toBe("assets/vip.png");

		const ops = diff(desiredResult.data, [prior, UNIVERSE_ADOPTED]);
		const nonNoop = ops.filter((op) => op.type !== "noop");

		expect(nonNoop.map((op) => op.type)).toStrictEqual(["update"]);

		const applyResult = await applyOps(ops, registry);
		assert(applyResult.success);

		const captured = httpClient.requests[0]!;

		await expect(readFormBytes(captured.request.body, "file")).resolves.toStrictEqual(
			REAL_ICON_BYTES,
		);
	});
});

async function hashPlaceholderIcon(
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<ResourceCurrentState<"gamePass">["iconFileHashes"]["en-us"]> {
	const probe = defineConfig({
		environments: { production: {} },
		passes: {
			probe: {
				name: "probe",
				description: "probe",
				icon: { "en-us": "assets/vip.png" },
				redacted: true,
			},
		},
	});
	const resolved = selectEnvironment(probe, "production");
	assert(resolved.success);
	const desired = await buildDesired(flattenConfig(resolved.data), readFile);
	assert(desired.success);
	const entry = findGamePassDesired(desired.data);
	return entry.iconFileHashes["en-us"];
}
