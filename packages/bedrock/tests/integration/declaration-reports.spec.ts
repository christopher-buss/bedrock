import { type } from "arktype";
import { assert, describe, it } from "vitest";

import {
	asResourceKey,
	type Config,
	createClackProgressAdapter,
	deploy,
	type DriverRegistry,
	type ProgressEvent,
} from "#src/index";
import type { StatePort } from "#src/ports/state-port";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { fakeClackPort } from "#tests/helpers/clack";
import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import {
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const trap = {
	async create() {
		throw new Error("Unexpected driver request");
	},
};
const registry: DriverRegistry = {
	developerProduct: trap,
	gamePass: trap,
	place: trap,
	universe: trap,
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

	it("should report persisted retired identities in every environment during a dry run", async ({
		expect,
	}) => {
		expect.assertions(3);

		const config: Config = {
			environments: { development: {}, production: {}, staging: {} },
			passes: { "vip-pass": { retired: "untrack" } },
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
		expect(result.data.ops[0]!.type).toBe("untrack");
		expect(store.writes).toStrictEqual([]);
	});

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
					production: {},
					staging: {
						passes: { "overlay-pass": { retired: "untrack" } },
						places: { "new-place": { movedFrom: "old-place", placeId: "9" } },
						products: { "new-product": { movedFrom: "old-product" } },
						universe: { movedFrom: "old-universe", universeId: "1" },
					},
				},
				passes: { gone: { retired: "untrack" } },
				places: { "gone-place": { retired: "untrack" } },
				products: { "gone-product": { retired: "untrack" } },
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
							universeCurrent({ key: asResourceKey("old-universe") }),
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
				key: "gone-place",
				activeEnvironments: [],
				declaration: "retired",
				oldKey: "gone-place",
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
			{
				key: "new-product",
				activeEnvironments: ["staging"],
				declaration: "movedFrom",
				environment: "staging",
				oldKey: "old-product",
				resourceKind: "developerProduct",
				unknownEnvironments: [],
			},
			{
				key: "new-place",
				activeEnvironments: ["staging"],
				declaration: "movedFrom",
				environment: "staging",
				oldKey: "old-place",
				resourceKind: "place",
				unknownEnvironments: [],
			},
			{
				key: "main",
				activeEnvironments: ["staging"],
				declaration: "movedFrom",
				environment: "staging",
				oldKey: "old-universe",
				resourceKind: "universe",
				unknownEnvironments: [],
			},
		]);
	});

	it("should report a noop rename from persisted keys on diff and from the saved rebound keys on deploy", async ({
		expect,
	}) => {
		expect.assertions(4);

		const current = gamePassCurrent();
		const config: Config = {
			environments: { production: {}, staging: {} },
			passes: {
				"vip-plus": {
					name: current.name,
					description: current.description,
					icon: current.icon,
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
