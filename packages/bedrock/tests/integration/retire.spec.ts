import {
	applyOps,
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	type BedrockState,
	buildDesired,
	createClackProgressAdapter,
	createDeveloperProductDriver,
	createGamePassDriver,
	createUniverseDriver,
	defaultKindRegistry,
	deploy,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	type ProgressEvent,
	selectEnvironment,
	type StatePort,
} from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";
import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it, vi } from "vitest";

import { REDACTED_ICON_BYTES } from "#src/core/redacted-icon";
import { fakeClackPort } from "#tests/helpers/clack";
import {
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";

const PASS = gamePassCurrent();
const CONFIG = {
	environments: { production: {} },
	passes: { "vip-pass": { retired: true } },
} as const;

async function noFilesAsync(): Promise<Uint8Array> {
	throw new Error("Retirement must not read files");
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
		developerProduct: trap,
		gamePass: createGamePassDriver({
			client: new GamePassesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: noFilesAsync,
			universeId: asRobloxAssetId("1"),
		}),
		place: trap,
		universe: trap,
	};
}

function stateHarness(
	resources: BedrockState["resources"],
	metadata: Pick<BedrockState, "realDisplay"> = {},
): {
	port: StatePort;
	writes: Array<BedrockState>;
} {
	let state: BedrockState = { ...metadata, environment: "production", resources, version: 1 };
	const writes: Array<BedrockState> = [];
	return {
		port: {
			async read() {
				return {
					data: { state, version: { kind: "present", token: "819" } },
					success: true,
				};
			},
			async write(next, expected) {
				assert.deepEqual(expected, { kind: "present", token: "819" });
				writes.push(next);
				state = next;
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

const MARKERS = {
	environments: { production: { redacted: true } },
	passes: { "absent": { retired: true }, "vip-pass": { retired: true } },
};
const JSON_MARKERS = JSON.stringify(MARKERS);
const SOURCES = [
	{ format: "json", source: JSON_MARKERS },
	{ format: "js", source: `export default ${JSON_MARKERS};` },
	{ format: "ts", source: `export default ${JSON_MARKERS};` },
	{
		format: "yaml",
		source: "environments:\n  production:\n    redacted: true\npasses:\n  absent:\n    retired: true\n  vip-pass:\n    retired: true\n",
	},
	...(HAS_LUTE
		? [
				{
					format: "luau",
					source: 'return { environments = { production = { redacted = true } }, passes = { absent = { retired = true }, ["vip-pass"] = { retired = true } } }',
				},
			]
		: []),
];

describe("game pass retirement", () => {
	it.for(SOURCES)(
		"should plan retirement from $format without reading retired files",
		async ({ format, source }, { expect, onTestFinished }) => {
			expect.hasAssertions();

			const cwd = await mkdtemp(join(tmpdir(), "bedrock-retire-"));
			onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
			await writeFile(join(cwd, `bedrock.config.${format}`), source);
			const loaded = await loadConfig({ cwd });

			expect(loaded).toMatchObject({ success: true });

			assert(loaded.success);
			const selected = selectEnvironment(loaded.data, "production");
			assert(selected.success);
			const desired = await buildDesired({
				async readFile() {
					throw new Error("Retirement must bypass files");
				},
				resources: flattenConfig(selected.data),
			});
			assert(desired.success);
			const current = gamePassCurrent();

			const ops = diff(desired.data, [current]);

			expect(ops).toHaveLength(2);
			expect(ops).toStrictEqual(
				expect.arrayContaining([
					{ key: "absent", kind: "gamePass", type: "noop" },
					{ key: current.key, current, type: "retire" },
				]),
			);
		},
	);

	it("should hide a pass and every stored icon locale before dropping its state and reporting success", async ({
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
			.mockResponse({ body: validGamePassBody(), status: 200 })
			.mockResponse({ body: {}, status: 200 })
			.mockResponse({ body: {}, status: 200 });
		const current = {
			...PASS,
			outputs: {
				...PASS.outputs,
				iconAssetIds: { ...PASS.outputs.iconAssetIds, "fr-fr": asRobloxAssetId("999") },
			},
		};
		const { port, writes } = stateHarness([current]);
		const events: Array<ProgressEvent> = [];
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			progress: {
				emit(event) {
					events.push(event);
				},
			},
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: port,
		});

		assert(result.success);

		expect(writes).toStrictEqual([{ environment: "production", resources: [], version: 1 }]);
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["PATCH", "/game-passes/v1/universes/1/game-passes/9876543210"],
			[
				"POST",
				"/legacy-game-internationalization/v1/game-passes/9876543210/icons/language-codes/en_us",
			],
			[
				"POST",
				"/legacy-game-internationalization/v1/game-passes/9876543210/icons/language-codes/fr_fr",
			],
		]);

		const patch = httpClient.requests[0]!.request.body;
		assert(patch instanceof FormData);

		expect({
			name: patch.get("name"),
			description: patch.get("description"),
			isForSale: patch.get("isForSale"),
		}).toStrictEqual({
			name: "zzz_DEPRECATED(2026-10-26 12:34:56.123)",
			description: "",
			isForSale: "false",
		});

		const images: Array<Uint8Array> = [];
		for (const { request } of httpClient.requests.slice(1)) {
			assert(request.body instanceof FormData);
			const image = request.body.get("Files");
			assert(image instanceof Blob);

			images.push(new Uint8Array(await image.arrayBuffer()));
		}

		expect(images).toStrictEqual([REDACTED_ICON_BYTES, REDACTED_ICON_BYTES]);
		expect(events).toStrictEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "VIP Pass",
					kind: "resourceOpSucceeded",
					opType: "retire",
					resourceKind: "gamePass",
					robloxId: "9876543210",
				}),
				expect.objectContaining({
					key: PASS.key,
					name: "VIP Pass",
					kind: "resourceOpStarted",
					opType: "retire",
					resourceKind: "gamePass",
					robloxId: "9876543210",
				}),
				expect.objectContaining({ failed: 0, kind: "applySummary", retired: 1 }),
			]),
		);
	});

	it("should require every kind to declare support or a refusal and refuse unsupported drivers without requests", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient();
		const options = { credential: { apiKey: "fake", kind: "apiKey" } as const, httpClient };
		const drivers = [
			createUniverseDriver({
				places: new PlacesClient(options),
				universes: new UniversesClient(options),
			}).retire(universeCurrent()),
		];
		const refused = await Promise.all(drivers);

		expect(
			refused.map((result) => {
				assert(!result.success);
				return result.err.message;
			}),
		).toStrictEqual(["Universe removal is not available at this time."]);

		expect(defaultKindRegistry.gamePass.assertRetirable(PASS.key)).toStrictEqual({
			data: undefined,
			success: true,
		});
		expect(defaultKindRegistry.universe.assertRetirable(PASS.key)).toMatchObject({
			err: { message: "Universe removal is not available at this time." },
			success: false,
		});
		expect(httpClient.requests).toStrictEqual([]);
	});

	it.for([0, 1, 2])(
		"should retain a failed retire at step %i, continue siblings, and converge on retry",
		async (step, { expect, onTestFinished }) => {
			expect.hasAssertions();

			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-10-26T12:34:56.000Z"));
			onTestFinished(() => {
				vi.useRealTimers();
			});
			const httpClient = createFakeHttpClient();
			for (let index = 0; index < step; index += 1) {
				httpClient.mockResponse({
					body: {},
					status: 200,
				});
			}

			httpClient.mockApiError({ message: "Retire rejected", statusCode: 400 });
			const current = {
				...PASS,
				outputs: {
					...PASS.outputs,
					iconAssetIds: { ...PASS.outputs.iconAssetIds, fr: asRobloxAssetId("999") },
				},
			};
			const orphan = placeCurrent({
				key: PASS.key,
				fileHash: undefined,
				filePath: undefined,
			});
			const sibling = placeCurrent();
			const { port, writes } = stateHarness([current, orphan, sibling]);
			const clack = fakeClackPort();
			const progress = createClackProgressAdapter({ clack });
			const config = {
				...CONFIG,
				environments: {
					production: { places: { "vip-pass": { placeId: orphan.placeId } } },
				},
				places: {
					"start-place": { retired: "untrack" },
					"vip-pass": {},
				},
			} as const;
			const options = {
				config,
				environment: "production",
				progress,
				readFile: noFilesAsync,
				registry: registry(httpClient),
				statePort: port,
			};
			const result = await deploy(options);

			assert(!result.success && result.err.kind === "applyFailed");

			httpClient
				.mockResponse({ body: validGamePassBody(), status: 200 })
				.mockResponse({ body: {}, status: 200 })
				.mockResponse({ body: {}, status: 200 });
			const retry = await deploy(options);

			expect([result.err.cause.failures, retry]).toMatchObject([
				[{ key: PASS.key, kind: "driverFailure" }],
				{ data: { resources: [orphan] }, success: true },
			]);
			expect(writes.map(({ resources }) => resources)).toStrictEqual([
				[current, orphan],
				[orphan],
			]);

			expect(vi.mocked(clack.logError).mock.calls.flat()).toStrictEqual(
				expect.arrayContaining([
					expect.stringContaining("VIP Pass (id 9876543210)"),
					"Failed in 0.0s: 0 create, 0 update, 1 untrack, 1 noop, 1 failed",
				]),
			);

			expect(clack.logSuccess).toHaveBeenCalledWith(
				"gamePass.vip-pass VIP Pass (id 9876543210) retired",
			);
			expect(clack.logMessage).toHaveBeenCalledWith(
				"Succeeded in 0.0s: 0 create, 0 update, 1 retire, 2 noop, 0 failed",
			);
		},
	);

	it("should drop a successful retire while retaining a failed sibling retire", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockApiError({ message: "Name rejected", statusCode: 409 })
			.mockResponse({ status: 200 });
		const failed = {
			...PASS,
			key: asResourceKey("other"),
			outputs: { ...PASS.outputs, assetId: asRobloxAssetId("222") },
		};
		const { port, writes } = stateHarness([PASS, failed]);
		const result = await deploy({
			config: { ...CONFIG, passes: { ...CONFIG.passes, other: { retired: true } } },
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: port,
		});

		expect(result).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(writes[0]!.resources).toStrictEqual([failed]);
		expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"PATCH",
			"PATCH",
			"POST",
		]);
	});

	it("should return the successful retirement identity to silent apply callers", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(2);

		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-26T12:34:56.000Z"));
		onTestFinished(() => {
			vi.useRealTimers();
		});

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 });

		await expect(
			applyOps([{ key: PASS.key, current: PASS, type: "retire" }], registry(httpClient)),
		).resolves.toStrictEqual({ data: [PASS], success: true });

		const patch = httpClient.requests[0]!.request.body;
		assert(patch instanceof FormData);

		expect(patch.get("name")).toBe("zzz_DEPRECATED(2026-10-26 12:34:56)");
	});

	it("should retain a complete recovery snapshot if retirement succeeds but its fenced state write fails", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 });
		const { port } = stateHarness([PASS]);
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: {
				...port,
				async write(_state, expected) {
					expect(expected).toStrictEqual({ kind: "present", token: "819" });

					return {
						err: { file: "production.json", kind: "stateConflict", reason: "Moved" },
						success: false,
					};
				},
			},
		});

		expect(result).toMatchObject({
			err: {
				kind: "stateWriteFailed",
				unsavedState: { environment: "production", resources: [], version: 1 },
			},
			success: false,
		});
	});

	it("should keep state and report an unknown stored locale instead of silently skipping it", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 });
		const current = {
			...PASS,
			outputs: {
				...PASS.outputs,
				iconAssetIds: { ...PASS.outputs.iconAssetIds, unknown: asRobloxAssetId("999") },
			},
		};
		const { port, writes } = stateHarness([current]);
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: port,
		});
		assert(!result.success && result.err.kind === "applyFailed");
		const [failure] = result.err.cause.failures;
		assert(failure.kind === "driverFailure");

		expect(failure.cause.message).toContain("unsupported icon locale 'unknown'");
		expect(writes[0]!.resources).toStrictEqual([current]);
	});

	it.for(["name", "price", "redacted", "movedFrom", "unknown"])(
		"should reject a retirement marker mixed with %s",
		async (field, { expect, onTestFinished }) => {
			expect.assertions(1);

			const cwd = await mkdtemp(join(tmpdir(), "bedrock-retire-strict-"));
			onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
			const results: Array<Awaited<ReturnType<typeof loadConfig>>> = [];
			for (const config of [
				{
					environments: { production: {} },
					passes: { vip: { [field]: "extra", retired: true } },
				},
				{
					environments: {
						production: { passes: { vip: { [field]: "extra", retired: true } } },
					},
				},
			]) {
				await writeFile(join(cwd, "bedrock.config.json"), JSON.stringify(config));

				results.push(await loadConfig({ cwd }));
			}

			expect(results).toMatchObject([
				{ err: { kind: "validationFailed" }, success: false },
				{ err: { kind: "validationFailed" }, success: false },
			]);
		},
	);

	it("should replace live fields only in the retired environment overlay", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(3);

		const cwd = await mkdtemp(join(tmpdir(), "bedrock-retire-overlay-"));
		onTestFinished(async () => rm(cwd, { force: true, recursive: true }));
		await writeFile(
			join(cwd, "bedrock.config.json"),
			JSON.stringify({
				environments: {
					production: { passes: { "vip-pass": { retired: true } }, redacted: true },
					staging: {},
				},
				passes: {
					"vip-pass": {
						name: "VIP",
						description: "Perks",
						icon: { "en-us": "missing.png" },
					},
				},
			}),
		);
		const loaded = await loadConfig({ cwd });
		assert(loaded.success);
		const selected = selectEnvironment(loaded.data, "production");
		const staging = selectEnvironment(loaded.data, "staging");
		assert(selected.success && staging.success);

		expect(selected.data.passes).toStrictEqual({ "vip-pass": { retired: true } });
		expect(staging.data.passes).toMatchObject({
			"vip-pass": { name: "VIP", description: "Perks" },
		});

		const desired = await buildDesired({
			readFile: noFilesAsync,
			resources: flattenConfig(selected.data),
		});
		assert(desired.success);

		expect(diff(desired.data, [PASS])).toStrictEqual([
			{ key: PASS.key, current: PASS, type: "retire" },
		]);
	});

	it("should retain a failed retire when a live sibling of another kind succeeds with the same key", async ({
		expect,
	}) => {
		expect.assertions(4);

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockApiError({ message: "Retire rejected", statusCode: 400 });
		const product = developerProductCurrent({ key: PASS.key });
		const events: Array<ProgressEvent> = [];
		const { port, writes } = stateHarness([PASS, product]);
		const result = await deploy({
			config: {
				...CONFIG,
				products: { "vip-pass": { name: "Updated gems", description: "Perks" } },
			},
			environment: "production",
			progress: {
				emit(event) {
					events.push(event);
				},
			},
			readFile: noFilesAsync,
			registry: {
				...registry(httpClient),
				developerProduct: createDeveloperProductDriver({
					client: new DeveloperProductsClient({
						credential: { apiKey: "fake", kind: "apiKey" },
						httpClient,
					}),
					readFile: noFilesAsync,
					universeId: asRobloxAssetId("1"),
				}),
			},
			statePort: port,
		});

		expect(result).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(writes[0]!.resources).toMatchObject([
			PASS,
			{ ...product, name: "Updated gems", description: "Perks" },
		]);
		expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"PATCH",
			"PATCH",
		]);
		expect(events).toContainEqual(
			expect.objectContaining({ failed: 1, kind: "applySummary", retired: 0, updated: 1 }),
		);
	});

	it("should retain redacted display metadata after a failed retirement and prune it only on success", async ({
		expect,
	}) => {
		expect.assertions(4);

		const httpClient = createFakeHttpClient().mockApiError({
			message: "Retire rejected",
			statusCode: 400,
		});
		const realDisplay = {
			"gamePass:vip-pass": { name: "Real VIP", description: "Real perks" },
		};
		const { port, writes } = stateHarness([PASS], { realDisplay });
		const options = {
			config: CONFIG,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: port,
		};
		const failed = await deploy(options);

		expect(failed).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(writes[0]!.realDisplay).toStrictEqual(realDisplay);

		httpClient.mockResponse({ status: 200 }).mockResponse({ status: 200 });

		await expect(deploy(options)).resolves.toMatchObject({ success: true });
		expect(writes[1]).toStrictEqual({ environment: "production", resources: [], version: 1 });
	});

	it("should retire one pass while a sibling rename preserves its Roblox identity", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 });
		const old = gamePassCurrent({
			key: asResourceKey("old"),
			iconFileHashes: {
				"en-us": asSha256Hex(
					"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				),
			},
			outputs: {
				assetId: asRobloxAssetId("222"),
				iconAssetIds: { "en-us": asRobloxAssetId("333") },
			},
		});
		const { port, writes } = stateHarness([PASS, old]);
		const result = await deploy({
			config: {
				...CONFIG,
				passes: {
					...CONFIG.passes,
					renamed: {
						name: old.name,
						description: old.description,
						icon: old.icon,
						movedFrom: "old",
						price: 500,
					},
				},
			},
			environment: "production",
			async readFile() {
				return new Uint8Array();
			},
			registry: registry(httpClient),
			statePort: port,
		});

		expect(result).toMatchObject({
			data: {
				resources: [
					{
						key: "renamed",
						outputs: { assetId: "222", iconAssetIds: { "en-us": "333" } },
					},
				],
			},
			success: true,
		});
		expect(writes[0]!.resources[0]).not.toHaveProperty("movedFrom");
		expect(httpClient.requests.map(({ request }) => request.url)).toStrictEqual([
			"/game-passes/v1/universes/1/game-passes/9876543210",
			"/legacy-game-internationalization/v1/game-passes/9876543210/icons/language-codes/en_us",
		]);
	});
});
