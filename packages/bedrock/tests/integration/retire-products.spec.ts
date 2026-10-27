import {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	type BedrockState,
	buildDesired,
	createDeveloperProductDriver,
	deploy,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	provision,
	selectEnvironment,
	type StatePort,
} from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { createFakeHttpClient, type FakeHttpClient } from "@bedrock-rbx/ocale/testing";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it, vi } from "vitest";

import { REDACTED_ICON_BYTES } from "#src/core/redacted-icon";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { developerProductCurrent } from "#tests/helpers/resources";

const CONFIG = {
	environments: { production: {} },
	products: { "gem-pack": { retired: true } },
} as const;
const PRODUCT = developerProductCurrent({
	outputs: {
		iconImageAssetId: asRobloxAssetId("1122334455"),
		productId: asRobloxAssetId("8172635495"),
	},
	price: 100,
});

async function noFilesAsync(): Promise<never> {
	throw new Error("Retirement must not read local icons");
}

function formFields(body: FormData): Record<string, Blob | string> {
	const fields: Record<string, Blob | string> = {};
	for (const key of body.keys()) {
		fields[key] = body.get(key)!;
	}

	return fields;
}

function registry(httpClient: FakeHttpClient): DriverRegistry {
	const trap = {
		async create(): Promise<never> {
			throw new Error("Unexpected create");
		},
		async retire(): Promise<never> {
			throw new Error("Unexpected retire");
		},
	};
	return {
		developerProduct: createDeveloperProductDriver({
			client: new DeveloperProductsClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: noFilesAsync,
			universeId: asRobloxAssetId("1234567890"),
		}),
		gamePass: trap,
		place: trap,
		universe: trap,
	};
}

function stateHarness(initial: BedrockState): { port: StatePort; writes: Array<BedrockState> } {
	let state = initial;
	const writes: Array<BedrockState> = [];
	return {
		port: {
			async read() {
				return {
					data: { state, version: { kind: "present", token: "820" } },
					success: true,
				};
			},
			async write(next, expected) {
				assert.deepEqual(expected, { kind: "present", token: "820" });
				state = next;
				writes.push(next);
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

describe("developer product retirement", () => {
	it("should hide a product and replace its recorded source icon before dropping persisted state", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-26T12:34:56.123Z"));
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 204 })
			.mockResponse({ status: 200 });
		const { port, writes } = stateHarness({
			environment: "production",
			resources: [PRODUCT],
			version: 1,
		});
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: port,
		});

		expect(result).toMatchObject({ data: { resources: [] }, success: true });
		expect(writes).toStrictEqual([{ environment: "production", resources: [], version: 1 }]);
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["PATCH", "/developer-products/v2/universes/1234567890/developer-products/8172635495"],
			[
				"POST",
				"/legacy-game-internationalization/v1/developer-products/8172635495/icons/language-codes/en_us",
			],
		]);

		const patch = httpClient.requests[0]!.request.body;
		assert(patch instanceof FormData);

		expect(formFields(patch)).toStrictEqual({
			name: "zzz_DEPRECATED(2026-10-26 12:34:56.123)",
			description: "",
			isForSale: "false",
		});

		const upload = httpClient.requests[1]!.request.body;
		assert(upload instanceof FormData);

		const image = upload.get("Files");
		assert(image instanceof Blob);

		expect({
			fields: [...upload.keys()],
			image: new Uint8Array(await image.arrayBuffer()),
		}).toStrictEqual({ fields: ["Files"], image: REDACTED_ICON_BYTES });
	});

	it.for([
		{ current: developerProductCurrent(), label: "absent icon" },
		{
			current: developerProductCurrent({
				icon: { "en-us": "old.png" },
				iconFileHashes: { "en-us": asSha256Hex("a".repeat(64)) },
			}),
			label: "authored icon without an output asset",
		},
	])(
		"should skip icon replacement without an icon asset recorded in state ($label)",
		async ({ current }, { expect, onTestFinished }) => {
			expect.hasAssertions();

			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-10-26T12:34:56.000Z"));
			onTestFinished(() => {
				vi.useRealTimers();
			});
			const httpClient = createFakeHttpClient().mockResponse({ status: 204 });
			const { port, writes } = stateHarness({
				environment: "production",
				resources: [current],
				version: 1,
			});
			const result = await deploy({
				config: CONFIG,
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(httpClient),
				statePort: port,
			});

			expect(result).toMatchObject({ success: true });
			expect(writes[0]!.resources).toStrictEqual([]);
			expect(httpClient.requests).toHaveLength(1);

			const patch = httpClient.requests[0]!.request.body;
			assert(patch instanceof FormData);

			expect(formFields(patch)).toStrictEqual({
				name: "zzz_DEPRECATED(2026-10-26 12:34:56)",
				description: "",
				isForSale: "false",
			});
		},
	);

	it.for([0, 1])(
		"should retain current state and real display after failure at step %i, continue siblings and safely retry",
		async (step, { expect }) => {
			expect.hasAssertions();

			const httpClient = createFakeHttpClient();
			for (let index = 0; index < step; index += 1) {
				httpClient.mockResponse({ status: 204 });
			}

			httpClient.mockApiError({ message: "Retirement rejected", statusCode: 400 });
			const sibling = developerProductCurrent({
				key: asResourceKey("other"),
				outputs: { productId: asRobloxAssetId("222") },
			});
			const realDisplay = {
				"developerProduct:gem-pack": {
					name: "Real Gems",
					description: "Real perks",
					price: 100,
				},
				"developerProduct:other": { name: "Other Gems" },
			};
			const { port, writes } = stateHarness({
				environment: "production",
				realDisplay,
				resources: [PRODUCT, sibling],
				version: 1,
			});
			const options = {
				config: {
					...CONFIG,
					products: { ...CONFIG.products, other: { retired: "untrack" } },
				} as const,
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(httpClient),
				statePort: port,
			};
			const failed = await deploy(options);

			expect(failed).toMatchObject({
				err: {
					cause: { failures: [{ key: "gem-pack", kind: "driverFailure" }] },
					kind: "applyFailed",
				},
				success: false,
			});
			expect({ requestCount: httpClient.requests.length, state: writes[0] }).toStrictEqual({
				requestCount: step + 1,
				state: {
					environment: "production",
					realDisplay: {
						"developerProduct:gem-pack": realDisplay["developerProduct:gem-pack"],
					},
					resources: [PRODUCT],
					version: 1,
				},
			});

			const requestsBeforeRetry = httpClient.requests.length;
			httpClient.mockResponse({ status: 204 }).mockResponse({ status: 200 });
			const retry = await deploy(options);

			expect([retry.success, writes[1]]).toStrictEqual([
				true,
				{
					environment: "production",
					resources: [],
					version: 1,
				},
			]);
			expect(
				httpClient.requests
					.slice(requestsBeforeRetry)
					.map(({ request }) => [request.method, request.url]),
			).toStrictEqual([
				[
					"PATCH",
					"/developer-products/v2/universes/1234567890/developer-products/8172635495",
				],
				[
					"POST",
					"/legacy-game-internationalization/v1/developer-products/8172635495/icons/language-codes/en_us",
				],
			]);

			const settled = await deploy(options);

			expect({ requestCount: httpClient.requests.length, result: settled }).toMatchObject({
				requestCount: requestsBeforeRetry + 2,
				result: { success: true },
			});
		},
	);

	it("should finish a sibling product retirement while retaining a rejected product", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient()
			.mockApiError({ message: "Name rejected", statusCode: 409 })
			.mockResponse({ status: 204 });
		const sibling = developerProductCurrent({
			key: asResourceKey("other"),
			outputs: { productId: asRobloxAssetId("222") },
		});
		const { port, writes } = stateHarness({
			environment: "production",
			resources: [PRODUCT, sibling],
			version: 1,
		});
		const result = await deploy({
			config: { ...CONFIG, products: { ...CONFIG.products, other: { retired: true } } },
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: port,
		});

		expect(result).toMatchObject({
			err: { cause: { failures: [{ key: "gem-pack" }] }, kind: "applyFailed" },
			success: false,
		});
		expect(writes[0]!.resources).toStrictEqual([PRODUCT]);
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["PATCH", "/developer-products/v2/universes/1234567890/developer-products/8172635495"],
			["PATCH", "/developer-products/v2/universes/1234567890/developer-products/222"],
		]);
	});

	it("should preserve the fenced recovery snapshot when a fully retired product cannot be saved", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 204 })
			.mockResponse({ status: 200 });
		const { port, writes } = stateHarness({
			environment: "production",
			resources: [PRODUCT],
			version: 1,
		});
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: {
				...port,
				async write(_state, expected) {
					expect(expected).toStrictEqual({ kind: "present", token: "820" });

					return {
						err: { file: "production.json", kind: "stateConflict", reason: "Moved" },
						success: false,
					};
				},
			},
		});

		expect({ result, writes }).toMatchObject({
			result: {
				err: {
					kind: "stateWriteFailed",
					unsavedState: { environment: "production", resources: [], version: 1 },
				},
				success: false,
			},
			writes: [],
		});
	});

	it("should load product markers, preserve live schema and plan noops for absent state", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		const cwd = await mkdtemp(join(tmpdir(), "bedrock-retire-product-"));
		onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
		await writeFile(
			join(cwd, "bedrock.config.json"),
			JSON.stringify({
				...CONFIG,
				environments: {
					production: { products: { "gem-pack": { retired: true } }, redacted: true },
				},
				products: {
					"absent": { retired: true },
					"gem-pack": {
						name: "Gems",
						description: "Perks",
						icon: { "en-us": "missing.png" },
					},
				},
			}),
		);
		const loaded = await loadConfig({ cwd });
		assert(loaded.success);
		const selected = selectEnvironment(loaded.data, "production");
		assert(selected.success);
		const desired = await buildDesired({
			readFile: noFilesAsync,
			resources: flattenConfig(selected.data),
		});
		assert(desired.success);

		expect(diff(desired.data, [PRODUCT])).toStrictEqual([
			{ key: "absent", kind: "developerProduct", type: "noop" },
			{ key: PRODUCT.key, current: PRODUCT, type: "retire" },
		]);
	});

	it("should preview product retirement without requests and retire it in the provision asset stage", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient();
		const { port, writes } = stateHarness({
			environment: "production",
			resources: [PRODUCT],
			version: 1,
		});
		const options = {
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: port,
		};
		const preview = await previewDiffAsync(options);

		expect(preview).toMatchObject({
			data: { ops: [{ key: PRODUCT.key, current: PRODUCT, type: "retire" }] },
			success: true,
		});
		expect({ requests: httpClient.requests, writes }).toStrictEqual({
			requests: [],
			writes: [],
		});

		httpClient.mockResponse({ status: 204 }).mockResponse({ status: 200 });
		const provisioned = await provision(options);

		expect(provisioned).toMatchObject({ success: true });
		expect(writes[0]!.resources).toStrictEqual([]);
		expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"PATCH",
			"POST",
		]);
	});
});
