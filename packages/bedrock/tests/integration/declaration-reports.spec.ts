import { type } from "arktype";
import { assert, describe, it } from "vitest";

import {
	asResourceKey,
	asRobloxAssetId,
	type Config,
	createClackProgressAdapter,
	deploy,
	type DriverRegistry,
	type ProgressEvent,
} from "#src/index";
import type { StatePort } from "#src/ports/state-port";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { fakeClackPort } from "#tests/helpers/clack";
import { BADGE_TRAP } from "#tests/helpers/drivers";
import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import {
	badgeCurrent,
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
} from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const trap = {
	async create() {
		throw new Error("Unexpected driver request");
	},
	async retire() {
		throw new Error("Unexpected retirement request");
	},
};
const registry: DriverRegistry = {
	badge: BADGE_TRAP,
	developerProduct: trap,
	gamePass: trap,
	place: trap,
	universe: trap,
};

const IMPORTED_PASS = {
	name: "VIP Pass",
	description: "Grants VIP perks.",
	icon: { "en-us": "assets/vip-icon.png" },
	price: 500,
};

function backendPlugins(stores: Readonly<Record<string, StatePort>>) {
	return fakeStateBackendPlugins({
		name: "test",
		createPort: ({ stateConfig }) => {
			const port = stores[stateConfig.bucket];
			return port === undefined
				? { err: { reason: "credentials unavailable" }, success: false }
				: { data: port, success: true };
		},
		schema: type({ bucket: "string" }),
		specifier: "test-backend",
	});
}

function rejectingRead(port: StatePort): StatePort {
	return {
		...port,
		async read(environment) {
			if (environment === "staging") {
				throw new Error("offline");
			}

			return port.read(environment);
		},
	};
}

describe("temporary declaration reports", () => {
	it("should avoid cross-environment reads when the config has no temporary declarations", async ({
		expect,
	}) => {
		expect.assertions(2);

		const trace: Array<string> = [];
		const result = await previewDiffAsync({
			config: { environments: { production: {}, staging: {} } },
			environment: "production",
			statePort: fakeStateStore({ trace }).port,
		});
		assert(result.success);

		expect(result.data.declarationReports).toStrictEqual([]);
		expect(trace).toStrictEqual(["read:production"]);
	});

	it("should reuse codegen observations from each environment's own backend", async ({
		expect,
	}) => {
		expect.assertions(3);

		const trace: Array<string> = [];
		const production = fakeStateStore({ label: "production", trace });
		const staging = fakeStateStore({
			initial: {
				staging: { environment: "staging", resources: [gamePassCurrent()], version: 1 },
			},
			label: "staging",
			trace,
		});
		const emitted: Array<ReadonlyArray<string>> = [];
		const clack = fakeClackPort();
		const result = await deploy({
			config: {
				codegen: { enabled: true },
				environments: {
					production: {},
					staging: { state: { backend: "test", bucket: "staging" } },
				},
				passes: { "vip-pass": { retired: "untrack" } },
				state: { backend: "test", bucket: "production" },
			},
			emit: ({ environments }) => {
				emitted.push(environments["staging"]!.resources.map((resource) => resource.key));
				return [];
			},
			environment: "production",
			plugins: backendPlugins({ production: production.port, staging: staging.port }),
			progress: createClackProgressAdapter({ clack }),
			registry,
		});
		assert(result.success);

		expect(emitted).toStrictEqual([["vip-pass"]]);
		expect(trace).toStrictEqual([
			"production-read:production",
			"production-write:production",
			"staging-read:staging",
		]);
		expect(clack.logMessage).toHaveBeenCalledWith(
			"gamePass:vip-pass retired: Still active in: staging.",
		);
	});

	it("should preserve codegen read failures and report unknown state without rereading a confirmed checkpoint", async ({
		expect,
	}) => {
		expect.assertions(3);

		const trace: Array<string> = [];
		const error = { file: "staging.json", kind: "stateError", reason: "offline" } as const;
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [gamePassCurrent()],
					version: 1,
				},
			},
			refuseRead: { staging: error },
			trace,
		});
		const clack = fakeClackPort();
		const result = await deploy({
			config: {
				codegen: { enabled: true },
				environments: { production: {}, staging: {} },
				passes: { "vip-pass": { retired: "untrack" } },
			},
			emit: () => [],
			environment: "production",
			progress: createClackProgressAdapter({ clack }),
			registry,
			statePort: store.port,
		});

		expect(result).toStrictEqual({
			err: {
				cause: { cause: error, environment: "staging", kind: "codegenStateReadFailed" },
				kind: "codegenFailed",
			},
			success: false,
		});
		expect(trace).toStrictEqual(["read:production", "write:production", "read:staging"]);
		expect(clack.logMessage).toHaveBeenCalledWith(
			"gamePass:vip-pass retired: Unknown in: staging.",
		);
	});

	it("should surface backend resolution failures to codegen while keeping the declaration unknown", async ({
		expect,
	}) => {
		expect.assertions(2);

		const clack = fakeClackPort();
		const result = await deploy({
			config: {
				codegen: { enabled: true },
				environments: {
					production: { state: { backend: "test", bucket: "production" } },
					staging: {},
				},
				passes: { gone: { retired: "untrack" } },
			},
			emit: () => [],
			environment: "production",
			plugins: backendPlugins({ production: fakeStateStore().port }),
			progress: createClackProgressAdapter({ clack }),
			registry,
		});

		expect(result).toStrictEqual({
			err: {
				cause: {
					cause: {
						file: "staging",
						kind: "stateError",
						reason: "Cannot read environment state: stateNotConfigured",
					},
					environment: "staging",
					kind: "codegenStateReadFailed",
				},
				kind: "codegenFailed",
			},
			success: false,
		});
		expect(clack.logMessage).toHaveBeenCalledWith(
			"gamePass:gone retired: Unknown in: staging.",
		);
	});

	it("should report the persisted old key after a fenced write fails rather than the unsaved untrack", async ({
		expect,
	}) => {
		expect.assertions(3);

		const trace: Array<string> = [];
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [gamePassCurrent()],
					version: 1,
				},
			},
			refuseWrite: {
				production: { file: "production.json", kind: "stateConflict", reason: "changed" },
			},
			trace,
		});
		const clack = fakeClackPort();
		const result = await deploy({
			config: {
				environments: { production: {} },
				passes: { "vip-pass": { retired: "untrack" } },
			},
			environment: "production",
			progress: createClackProgressAdapter({ clack }),
			registry,
			statePort: store.port,
		});
		assert(!result.success);

		expect(result.err.kind).toBe("stateWriteFailed");
		expect(trace).toStrictEqual(["read:production", "write:production", "read:production"]);
		expect(clack.logMessage).toHaveBeenCalledWith(
			"gamePass:vip-pass retired: Still active in: production.",
		);
	});

	it("should leave an environment without configured state unknown", async ({ expect }) => {
		expect.assertions(1);

		const result = await previewDiffAsync({
			config: {
				environments: {
					missing: {},
					production: { state: { backend: "test", bucket: "production" } },
				},
				passes: { gone: { retired: "untrack" } },
			},
			environment: "production",
			plugins: backendPlugins({ production: fakeStateStore().port }),
		});
		assert(result.success);

		expect(result.data.declarationReports).toMatchObject([
			{ activeEnvironments: [], unknownEnvironments: ["missing"] },
		]);
	});

	it.for([
		["untrack", "untrack"],
		[true, "retire"],
	] as const)(
		"should report persisted retired identities for %s in every environment during a dry run",
		async ([retired, operation], { expect }) => {
			expect.assertions(3);

			const config: Config = {
				environments: { development: {}, production: {}, staging: {} },
				passes: { "vip-pass": { retired } },
			};
			const store = fakeStateStore({
				initial: {
					production: {
						environment: "production",
						resources: [gamePassCurrent()],
						version: 1,
					},
					staging: { environment: "staging", resources: [gamePassCurrent()], version: 1 },
				},
			});
			const result = await previewDiffAsync({
				config,
				environment: "production",
				statePort: store.port,
			});
			assert(result.success);

			expect(result.data).toHaveProperty("declarationReports", [
				{
					key: "vip-pass",
					activeEnvironments: ["production", "staging"],
					declaration: "retired",
					oldKey: "vip-pass",
					resourceKind: "gamePass",
					unknownEnvironments: [],
				},
			]);
			expect(result.data.ops[0]!.type).toBe(operation);
			expect(store.writes).toStrictEqual([]);
		},
	);

	it("should keep unreadable environments unknown while continuing to check later environments", async ({
		expect,
	}) => {
		expect.assertions(1);

		const store = fakeStateStore({
			initial: {
				staging: { environment: "staging", resources: [gamePassCurrent()], version: 1 },
			},
			refuseRead: {
				broken: { file: "broken.json", kind: "stateError", reason: "unavailable" },
			},
		});
		const result = await previewDiffAsync({
			config: {
				environments: { broken: {}, production: {}, staging: {} },
				passes: { "vip-pass": { retired: "untrack" } },
			},
			environment: "production",
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.declarationReports![0]).toMatchObject({
			activeEnvironments: ["staging"],
			unknownEnvironments: ["broken"],
		});
	});

	it("should report a successfully persisted untrack as safe through the deploy progress port without reading the active environment twice", async ({
		expect,
	}) => {
		expect.assertions(4);

		const trace: Array<string> = [];
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [gamePassCurrent()],
					version: 1,
				},
			},
			trace,
		});
		const clack = fakeClackPort();
		const result = await deploy({
			config: {
				environments: { production: {}, staging: {} },
				passes: { "vip-pass": { retired: "untrack" } },
			},
			environment: "production",
			progress: createClackProgressAdapter({ clack }),
			registry,
			statePort: store.port,
		});

		expect(result.success).toBe(true);
		expect(clack.logMessage).toHaveBeenCalledWith(
			"gamePass:vip-pass retired: Safe to drop declaration (absent from every environment's persisted state).",
		);
		expect(trace).toStrictEqual(["read:production", "write:production", "read:staging"]);
		expect(store.writes).toStrictEqual([
			{ environment: "production", expected: { kind: "present", token: "production-1" } },
		]);
	});

	it("should inspect each environment's own backend and preserve unknown status when its backend cannot be built", async ({
		expect,
	}) => {
		expect.assertions(1);

		const empty = fakeStateStore();
		const staging = fakeStateStore({
			initial: {
				staging: { environment: "staging", resources: [gamePassCurrent()], version: 1 },
			},
		});
		const plugins = backendPlugins({ production: empty.port, staging: staging.port });
		const result = await previewDiffAsync({
			config: {
				environments: {
					broken: { state: { backend: "test", bucket: "unavailable" } },
					production: {},
					staging: { state: { backend: "test", bucket: "staging" } },
				},
				passes: { "vip-pass": { retired: "untrack" } },
				state: { backend: "test", bucket: "production" },
			},
			environment: "production",
			plugins,
		});
		assert(result.success);

		expect(result.data.declarationReports![0]).toMatchObject({
			activeEnvironments: ["staging"],
			unknownEnvironments: ["broken"],
		});
	});

	it("should report root and overlay declarations of each kind by old identity without confusing another kind or key", async ({
		expect,
	}) => {
		expect.assertions(1);

		const result = await previewDiffAsync({
			config: {
				environments: {
					production: { places: { "new-place": { placeId: "8" } } },
					staging: {
						passes: { "overlay-pass": { retired: "untrack" } },
						places: { "new-place": { placeId: "9" } },
					},
				},
				passes: { gone: { retired: "untrack" } },
				places: {
					"gone-place": { retired: "untrack" },
					"new-place": { movedFrom: "old-place" },
				},
				products: {
					"gone-product": { retired: "untrack" },
					"new-product": {
						name: "New",
						description: "Product",
						movedFrom: "old-product",
					},
				},
			},
			environment: "production",
			statePort: fakeStateStore({
				initial: {
					staging: {
						environment: "staging",
						resources: [
							developerProductCurrent({ key: asResourceKey("gone") }),
							gamePassCurrent({ key: asResourceKey("unrelated") }),
							gamePassCurrent({ key: asResourceKey("overlay-pass") }),
							developerProductCurrent({ key: asResourceKey("old-product") }),
							placeCurrent({ key: asResourceKey("old-place") }),
						],
						version: 1,
					},
				},
			}).port,
		});
		assert(result.success);

		expect(result.data.declarationReports).toStrictEqual([
			{
				key: "gone",
				activeEnvironments: [],
				declaration: "retired",
				oldKey: "gone",
				resourceKind: "gamePass",
				unknownEnvironments: [],
			},
			{
				key: "gone-product",
				activeEnvironments: [],
				declaration: "retired",
				oldKey: "gone-product",
				resourceKind: "developerProduct",
				unknownEnvironments: [],
			},
			{
				key: "new-product",
				activeEnvironments: ["staging"],
				declaration: "movedFrom",
				oldKey: "old-product",
				resourceKind: "developerProduct",
				unknownEnvironments: [],
			},
			{
				key: "gone-place",
				activeEnvironments: [],
				declaration: "retired",
				oldKey: "gone-place",
				resourceKind: "place",
				unknownEnvironments: [],
			},
			{
				key: "new-place",
				activeEnvironments: ["staging"],
				declaration: "movedFrom",
				oldKey: "old-place",
				resourceKind: "place",
				unknownEnvironments: [],
			},
			{
				key: "overlay-pass",
				activeEnvironments: ["staging"],
				declaration: "retired",
				environment: "staging",
				oldKey: "overlay-pass",
				resourceKind: "gamePass",
				unknownEnvironments: [],
			},
		]);
	});

	it("should report badge declarations from the root and overlays", async ({ expect }) => {
		expect.assertions(1);

		const result = await previewDiffAsync({
			config: {
				badges: {
					"gone-badge": { retired: "untrack" },
					"new-badge": {
						name: "New",
						description: "Badge",
						icon: { "en-us": "assets/new.png" },
						movedFrom: "old-badge",
					},
				},
				environments: {
					production: {},
					staging: { badges: { "overlay-badge": { retired: "untrack" } } },
				},
			},
			environment: "production",
			readFile: async () => new Uint8Array([1]),
			readFreeBadgeQuota: async () => ({ data: 5, success: true }),
			statePort: fakeStateStore({
				initial: {
					staging: {
						environment: "staging",
						resources: [
							badgeCurrent({ key: asResourceKey("old-badge") }),
							badgeCurrent({ key: asResourceKey("overlay-badge") }),
						],
						version: 1,
					},
				},
			}).port,
		});
		assert(result.success);

		expect(result.data.declarationReports).toStrictEqual([
			{
				key: "gone-badge",
				activeEnvironments: [],
				declaration: "retired",
				oldKey: "gone-badge",
				resourceKind: "badge",
				unknownEnvironments: [],
			},
			{
				key: "new-badge",
				activeEnvironments: ["staging"],
				declaration: "movedFrom",
				oldKey: "old-badge",
				resourceKind: "badge",
				unknownEnvironments: [],
			},
			{
				key: "overlay-badge",
				activeEnvironments: ["staging"],
				declaration: "retired",
				environment: "staging",
				oldKey: "overlay-badge",
				resourceKind: "badge",
				unknownEnvironments: [],
			},
		]);
	});

	it("should report a noop rename from persisted keys on diff and from the saved rebound keys on deploy", async ({
		expect,
	}) => {
		expect.assertions(4);

		const current = gamePassCurrent({ isManagedPricingEnabled: true });
		const config: Config = {
			environments: { production: {}, staging: {} },
			passes: {
				"vip-plus": {
					name: current.name,
					description: current.description,
					icon: current.icon,
					isManagedPricingEnabled: true,
					movedFrom: "vip-pass",
					price: 500,
				},
			},
		};
		const store = fakeStateStore({
			initial: {
				production: { environment: "production", resources: [current], version: 1 },
			},
		});
		const preview = await previewDiffAsync({
			config,
			environment: "production",
			readFile: async () => new Uint8Array(),
			statePort: store.port,
		});
		assert(preview.success);

		expect(preview.data.ops[0]!.type).toBe("noop");
		expect(preview.data.declarationReports![0]).toMatchObject({
			key: "vip-plus",
			activeEnvironments: ["production"],
			declaration: "movedFrom",
			oldKey: "vip-pass",
		});

		const events: Array<ProgressEvent> = [];
		const result = await deploy({
			config,
			environment: "production",
			progress: {
				emit: (event) => {
					events.push(event);
				},
			},
			readFile: async () => new Uint8Array(),
			registry,
			statePort: store.port,
		});
		assert(result.success);

		expect(events.filter((event) => event.kind === "declarationReport")).toStrictEqual([
			{
				environment: "production",
				kind: "declarationReport",
				report: {
					key: "vip-plus",
					activeEnvironments: [],
					declaration: "movedFrom",
					oldKey: "vip-pass",
					resourceKind: "gamePass",
					unknownEnvironments: [],
				},
			},
		]);
		expect(result.data.resources[0]!.outputs).toStrictEqual(current.outputs);
	});

	it("should list the overlay environment as still needing import lines before its state holds the key", async ({
		expect,
	}) => {
		expect.assertions(1);

		const result = await previewDiffAsync({
			config: {
				environments: {
					production: {},
					staging: {
						passes: {
							"vip-pass": {
								iconBaseline: "accept-local-file",
								importId: "9876543210",
							},
						},
					},
				},
				passes: { "vip-pass": IMPORTED_PASS },
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			statePort: fakeStateStore().port,
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.declarationReports).toStrictEqual([
			{
				key: "vip-pass",
				activeEnvironments: ["staging"],
				declaration: "importId",
				environment: "staging",
				oldKey: "vip-pass",
				resourceKind: "gamePass",
				unknownEnvironments: [],
			},
			{
				key: "vip-pass",
				activeEnvironments: ["staging"],
				declaration: "iconBaseline",
				environment: "staging",
				oldKey: "vip-pass",
				resourceKind: "gamePass",
				unknownEnvironments: [],
			},
		]);
	});

	it.for([
		[
			"holds the imported key",
			[gamePassCurrent({ key: asResourceKey("other-pass") }), gamePassCurrent()],
			[],
		],
		[
			"holds only another kind, key or roblox id",
			[
				developerProductCurrent({
					key: asResourceKey("vip-pass"),
					outputs: { productId: asRobloxAssetId("9876543210") },
				}),
				gamePassCurrent({ key: asResourceKey("other-pass") }),
				gamePassCurrent({
					outputs: {
						assetId: asRobloxAssetId("1"),
						iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
					},
				}),
			],
			["staging"],
		],
	] as const)(
		"should check the import line against the overlay environment's state when it %s",
		async ([, resources, activeEnvironments], { expect }) => {
			expect.assertions(1);

			const result = await previewDiffAsync({
				config: {
					environments: {
						production: {},
						staging: { passes: { "vip-pass": { importId: "9876543210" } } },
					},
					passes: { "vip-pass": IMPORTED_PASS },
				},
				environment: "production",
				readFile: async () => new Uint8Array(),
				statePort: fakeStateStore({
					initial: {
						production: {
							environment: "production",
							resources: [gamePassCurrent({ key: asResourceKey("vip-pass") })],
							version: 1,
						},
						staging: { environment: "staging", resources, version: 1 },
					},
				}).port,
			});
			assert(result.success, JSON.stringify(result));

			expect(result.data.declarationReports).toMatchObject([
				{ activeEnvironments, declaration: "importId", unknownEnvironments: [] },
			]);
		},
	);

	it("should report an import line unknown only when its own environment's state cannot be read", async ({
		expect,
	}) => {
		expect.assertions(1);

		const unavailable = { file: "x.json", kind: "stateError", reason: "offline" } as const;
		const result = await previewDiffAsync({
			config: {
				environments: {
					broken: {},
					production: {},
					staging: {
						passes: {
							"vip-pass": {
								iconBaseline: "accept-local-file",
								importId: "9876543210",
							},
						},
					},
					testing: { passes: { "vip-pass": { importId: "9876543210" } } },
				},
				passes: { "vip-pass": IMPORTED_PASS },
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			statePort: fakeStateStore({
				refuseRead: { broken: unavailable, staging: unavailable },
			}).port,
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.declarationReports).toMatchObject([
			{ activeEnvironments: [], declaration: "importId", unknownEnvironments: ["staging"] },
			{
				activeEnvironments: [],
				declaration: "iconBaseline",
				unknownEnvironments: ["staging"],
			},
			{
				activeEnvironments: ["testing"],
				declaration: "importId",
				environment: "testing",
				unknownEnvironments: [],
			},
		]);
	});

	it("should keep a successful deploy successful when another environment's read rejects", async ({
		expect,
	}) => {
		expect.assertions(2);

		const events: Array<ProgressEvent> = [];
		const store = fakeStateStore();
		const result = await deploy({
			config: {
				environments: { production: {}, staging: {} },
				passes: { gone: { retired: "untrack" } },
			},
			environment: "production",
			progress: {
				emit: (event) => {
					events.push(event);
				},
			},
			registry,
			statePort: rejectingRead(store.port),
		});

		expect(result.success).toBe(true);
		expect(events.filter((event) => event.kind === "declarationReport")).toMatchObject([
			{ report: { activeEnvironments: [], unknownEnvironments: ["staging"] } },
		]);
	});
});
