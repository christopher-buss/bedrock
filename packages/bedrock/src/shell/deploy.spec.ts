import { OpenCloudError } from "@bedrock-rbx/ocale";
import type { Result } from "@bedrock-rbx/ocale";

import { type } from "arktype";
import process from "node:process";
import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { outcomeByKey } from "#tests/helpers/drivers";
import { environmentFrom } from "#tests/helpers/environment";
import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import {
	gamePassDesired,
	placeCurrent,
	placeDesired,
	universeCurrent,
	universeDesired,
} from "#tests/helpers/resources";
import { resultsInOrder } from "#tests/helpers/sequence";
import { captureStreams } from "#tests/helpers/streams";
import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { CodegenFile, EmitInput, Emitter } from "../core/codegen.ts";
import { UNIVERSE_SINGLETON_KEY } from "../core/resources.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState, StateError, StateRecord } from "../core/state.ts";
import type { CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { ProgressEvent, ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex, type ResourceKey } from "../types/ids.ts";
import { type BuildStep, deploy, type DeployError, isCliEnvironmentFlagSet } from "./deploy.ts";

// Empty bytes hash to SHA-256 `e3b0c44...`; keeping readIcon in lockstep with
// the hash constant lets the noop test assert "desired matches current" without
// recomputing digests at runtime.
const ICON_BYTES = new Uint8Array();
const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

async function readIconAsync(): Promise<Uint8Array> {
	return ICON_BYTES;
}

const developerProductStub: ResourceDriver<"developerProduct"> = {
	async create() {
		throw new Error("developerProduct driver must not run for this fixture");
	},
};

const placeStub: ResourceDriver<"place"> = {
	async create() {
		throw new Error("place driver must not run for this fixture");
	},
};

const universeStub: ResourceDriver<"universe"> = {
	async create() {
		throw new Error("universe driver must not run for this fixture");
	},
};

function inMemoryStatePort(initial?: BedrockState): {
	port: StatePort;
	writes: Array<BedrockState>;
} {
	let current = initial;
	const writes: Array<BedrockState> = [];
	return {
		port: {
			async read() {
				return { data: { state: current }, success: true };
			},
			async write(state) {
				writes.push(state);
				current = state;
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

function vipPassConfig(): Config {
	return {
		environments: { production: {} },
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				price: 500,
			},
		},
	};
}

function vipPassCurrent() {
	return {
		key: asResourceKey("vip-pass"),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		icon: { "en-us": "assets/vip-icon.png" },
		iconFileHashes: { "en-us": ICON_HASH },
		kind: "gamePass" as const,
		outputs: {
			assetId: asRobloxAssetId("9876543210"),
			iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
		},
		price: 500,
	};
}

function twoPassConfig(): Config {
	// Keys ordered for deterministic dispatch: lint sorts collection keys
	// alphabetically, so alpha-pass runs first and vip-pass second. Tests
	// rely on that order when asserting which dispatch failed.
	return {
		environments: { production: {} },
		passes: {
			"alpha-pass": {
				name: "Alpha Pass",
				description: "Grants alpha perks.",
				icon: { "en-us": "assets/alpha-icon.png" },
				price: 250,
			},
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				price: 500,
			},
		},
	};
}

function configWithState(): Config {
	return {
		environments: { production: {} },
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				price: 500,
			},
		},
		state: { backend: "gist", gistId: "abc-test" },
		universe: { universeId: "1234567890" },
	};
}

function stubRegistry(): DriverRegistry {
	return {
		developerProduct: developerProductStub,
		gamePass: {
			async create() {
				throw new Error("game-pass driver must not run for this fixture");
			},
		},
		place: placeStub,
		universe: universeStub,
	};
}

function stubRegistryWithVipCreate(): DriverRegistry {
	return {
		developerProduct: developerProductStub,
		gamePass: {
			async create() {
				return { data: vipPassCurrent(), success: true };
			},
		},
		place: placeStub,
		universe: universeStub,
	};
}

async function failingLoadConfigAsync(): Promise<{
	err: { kind: "fileNotFound"; searchedFrom: string };
	success: false;
}> {
	return {
		err: { kind: "fileNotFound", searchedFrom: "/tmp" },
		success: false,
	};
}

function alphaPassCurrent() {
	return {
		key: asResourceKey("alpha-pass"),
		name: "Alpha Pass",
		description: "Grants alpha perks.",
		icon: { "en-us": "assets/alpha-icon.png" },
		iconFileHashes: { "en-us": ICON_HASH },
		kind: "gamePass" as const,
		outputs: {
			assetId: asRobloxAssetId("1111111111"),
			iconAssetIds: { "en-us": asRobloxAssetId("2222222222") },
		},
		price: 250,
	};
}

const CODEGEN_FILE: CodegenFile = { content: "return {}\n", path: "ids.luau" };

function inMemoryCodegenWriter(): { port: CodegenWriterPort; writes: Array<CodegenFile> } {
	const writes: Array<CodegenFile> = [];
	return {
		port: {
			async write(file) {
				writes.push(file);
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

function environmentAwareStatePort(initial: Record<string, BedrockState>): StatePort {
	const store = new Map<string, BedrockState>(Object.entries(initial));
	return {
		async read(environment) {
			return { data: { state: store.get(environment) }, success: true };
		},
		async write(state) {
			store.set(state.environment, state);
			return { data: undefined, success: true };
		},
	};
}

const VipPassEntry = {
	name: "VIP Pass",
	description: "Grants VIP perks.",
	icon: { "en-us": "assets/vip-icon.png" },
	price: 500,
} as const;

function codegenVipConfig(output?: string): Config {
	return {
		codegen: { enabled: true, ...(output === undefined ? {} : { output }) },
		environments: { production: {} },
		passes: { "vip-pass": VipPassEntry },
	};
}

describe(deploy, () => {
	it("should persist a universe-only-id alongside a place sharing the singleton key as separate state entries", async () => {
		expect.assertions(3);

		const placeIdValue = asRobloxAssetId("84607999013117");
		const universeCreated = universeCurrent();
		const placeCreated = placeCurrent({
			key: UNIVERSE_SINGLETON_KEY,
			placeId: placeIdValue,
		});
		const universeCreate = vi
			.fn<ResourceDriver<"universe">["create"]>()
			.mockResolvedValue({ data: universeCreated, success: true });
		const placeCreate = vi
			.fn<ResourceDriver<"place">["create"]>()
			.mockResolvedValue({ data: placeCreated, success: true });
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: {
				create() {
					throw new Error("gamePass driver must not run for this fixture");
				},
			},
			place: { create: placeCreate },
			universe: { create: universeCreate },
		};
		const { port, writes } = inMemoryStatePort();

		const result = await deploy({
			config: {
				environments: {
					production: { places: { main: { placeId: placeIdValue } } },
				},
				places: { main: { filePath: "anime-rush.rbxl" } },
				universe: { universeId: "1234567890" },
			},
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		assert(result.success);

		expect(universeCreate).toHaveBeenCalledExactlyOnceWith(universeDesired());
		expect(placeCreate).toHaveBeenCalledExactlyOnceWith(
			placeDesired({
				key: UNIVERSE_SINGLETON_KEY,
				fileHash: ICON_HASH,
				filePath: "anime-rush.rbxl",
				placeId: placeIdValue,
			}),
		);
		expect(writes[0]!.resources).toStrictEqual([universeCreated, placeCreated]);
	});

	it("should preserve prior resources of distinct kinds that share a key when desired is empty", async () => {
		expect.assertions(2);

		const priorUniverse = universeCurrent();
		const priorPlace = placeCurrent({ key: UNIVERSE_SINGLETON_KEY });
		const { port, writes } = inMemoryStatePort({
			environment: "production",
			resources: [priorUniverse, priorPlace],
			version: 1,
		});

		const result = await deploy({
			config: { environments: { production: {} }, passes: {} },
			environment: "production",
			readFile: readIconAsync,
			registry: stubRegistry(),
			statePort: port,
		});

		assert(result.success);

		expect(writes).toHaveLength(1);
		expect(writes[0]!.resources).toStrictEqual([priorUniverse, priorPlace]);
	});

	it("should reconcile a first deploy by creating the desired resource and persisting the new state", async () => {
		expect.assertions(5);

		const created = vipPassCurrent();
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: created, success: true });
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create },
			place: placeStub,
			universe: universeStub,
		};
		const { port, writes } = inMemoryStatePort();

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		expect(create).toHaveBeenCalledExactlyOnceWith(gamePassDesired());
		expect(writes).toHaveLength(1);
		expect(writes[0]!.environment).toBe("production");
		expect(writes[0]!.resources).toStrictEqual([created]);
		expect(result).toStrictEqual({ data: writes[0], success: true });
	});

	it("should persist the unchanged snapshot and skip driver dispatch when desired matches current state", async () => {
		expect.assertions(3);

		const existing = vipPassCurrent();
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const update = vi.fn<NonNullable<ResourceDriver<"gamePass">["update"]>>();
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create, update },
			place: placeStub,
			universe: universeStub,
		};
		const { port } = inMemoryStatePort({
			environment: "production",
			resources: [existing],
			version: 1,
		});

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		expect(create).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(result).toStrictEqual({
			data: { environment: "production", resources: [existing], version: 1 },
			success: true,
		});
	});

	it("should overwrite the prior resource with the applied version when the same key is updated", async () => {
		expect.assertions(3);

		const existing = vipPassCurrent();
		const updated = { ...existing, price: 750 };
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const update = vi
			.fn<NonNullable<ResourceDriver<"gamePass">["update"]>>()
			.mockResolvedValue({ data: updated, success: true });
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create, update },
			place: placeStub,
			universe: universeStub,
		};
		const { port, writes } = inMemoryStatePort({
			environment: "production",
			resources: [existing],
			version: 1,
		});
		const config: Config = {
			environments: { production: {} },
			passes: {
				"vip-pass": {
					name: "VIP Pass",
					description: "Grants VIP perks.",
					icon: { "en-us": "assets/vip-icon.png" },
					price: 750,
				},
			},
		};

		const result = await deploy({
			config,
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		expect(update).toHaveBeenCalledExactlyOnceWith(existing, gamePassDesired({ price: 750 }));
		expect(writes[0]!.resources).toStrictEqual([updated]);
		expect(result).toStrictEqual({ data: writes[0], success: true });
	});

	it("should persist the partial-apply snapshot and surface applyFailed when a driver fails mid-sequence", async () => {
		expect.assertions(4);

		const alphaCurrent = alphaPassCurrent();
		const cause = new OpenCloudError("create vip-pass: 503");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementation(outcomeByKey({ "alpha-pass": alphaCurrent, "vip-pass": cause }));
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create },
			place: placeStub,
			universe: universeStub,
		};
		const { port, writes } = inMemoryStatePort();

		const result = await deploy({
			config: twoPassConfig(),
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		expect(create).toHaveBeenCalledTimes(2);
		expect(writes).toHaveLength(1);
		expect(writes[0]!.resources).toStrictEqual([alphaCurrent]);
		expect(result).toStrictEqual({
			err: {
				cause: {
					applied: [alphaCurrent],
					failures: [
						{
							key: asResourceKey("vip-pass"),
							cause,
							kind: "driverFailure",
						},
					],
				},
				kind: "applyFailed",
			},
			success: false,
		});
	});

	it("should persist Phase 2 survivors alongside Phase 1 universe success when one Phase 2 op fails", async () => {
		expect.assertions(3);

		const placeIdValue = asRobloxAssetId("84607999013117");
		const universeCreated = universeCurrent();
		const placeCreated = placeCurrent({ outputs: { versionNumber: 1 } });
		const alphaCurrent = alphaPassCurrent();
		const cause = new OpenCloudError("create vip-pass: 503");
		const universeCreate = vi
			.fn<ResourceDriver<"universe">["create"]>()
			.mockResolvedValue({ data: universeCreated, success: true });
		const placeCreate = vi
			.fn<ResourceDriver<"place">["create"]>()
			.mockResolvedValue({ data: placeCreated, success: true });
		const gamePassCreate = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementation(outcomeByKey({ "alpha-pass": alphaCurrent, "vip-pass": cause }));
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create: gamePassCreate },
			place: { create: placeCreate },
			universe: { create: universeCreate },
		};
		const { port, writes } = inMemoryStatePort();

		const result = await deploy({
			config: {
				...twoPassConfig(),
				environments: {
					production: { places: { main: { placeId: placeIdValue } } },
				},
				places: { main: { filePath: "anime-rush.rbxl" } },
				universe: { universeId: "1234567890" },
			},
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		expect(writes).toHaveLength(1);
		expect(writes[0]!.resources).toStrictEqual([universeCreated, alphaCurrent, placeCreated]);

		assert(!result.success);

		expect(result.err).toStrictEqual({
			cause: {
				applied: [universeCreated, alphaCurrent, placeCreated],
				failures: [{ key: asResourceKey("vip-pass"), cause, kind: "driverFailure" }],
			},
			kind: "applyFailed",
		});
	});

	it("should surface stateReadFailed without dispatching drivers or writing state when StatePort.read returns Err", async () => {
		expect.assertions(3);

		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create },
			place: placeStub,
			universe: universeStub,
		};
		const writes: Array<BedrockState> = [];
		const stateError = {
			file: ".bedrock/state/production.json",
			kind: "stateError" as const,
			reason: "Corrupt JSON: unexpected token",
		};
		const port: StatePort = {
			async read() {
				return { err: stateError, success: false };
			},
			async write(state) {
				writes.push(state);
				return { data: undefined, success: true };
			},
		};

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		expect(create).not.toHaveBeenCalled();
		expect(writes).toHaveLength(0);
		expect(result).toStrictEqual({
			err: { cause: stateError, kind: "stateReadFailed" },
			success: false,
		});
	});

	it("should surface stateWriteFailed with the partial-success unsavedState when both apply and state-write fail", async () => {
		expect.assertions(3);

		const alphaCurrent = alphaPassCurrent();
		const cause = new OpenCloudError("create vip-pass: 503");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementation(outcomeByKey({ "alpha-pass": alphaCurrent, "vip-pass": cause }));
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create },
			place: placeStub,
			universe: universeStub,
		};
		const stateError = {
			file: ".bedrock/state/production.json",
			kind: "stateError" as const,
			reason: "EACCES",
		};
		const writeAttempts: Array<BedrockState> = [];
		const port: StatePort = {
			async read() {
				return { data: {}, success: true };
			},
			async write(state) {
				writeAttempts.push(state);
				return { err: stateError, success: false };
			},
		};

		const result = await deploy({
			config: twoPassConfig(),
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		expect(writeAttempts).toHaveLength(1);
		expect(writeAttempts[0]!.resources).toStrictEqual([alphaCurrent]);
		expect(result).toStrictEqual({
			err: {
				cause: stateError,
				kind: "stateWriteFailed",
				unrecorded: [alphaCurrent],
				unsavedState: {
					environment: "production",
					resources: [alphaCurrent],
					version: 1,
				},
			},
			success: false,
		});
	});

	it("should report only the resources this deploy applied as unrecorded when the state write fails", async () => {
		expect.assertions(2);

		const alreadyRecorded = alphaPassCurrent();
		const created = vipPassCurrent();
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: created, success: true });
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create },
			place: placeStub,
			universe: universeStub,
		};
		const port: StatePort = {
			async read() {
				return {
					data: {
						state: {
							environment: "production",
							resources: [alreadyRecorded],
							version: 1,
						},
					},
					success: true,
				};
			},
			async write() {
				return {
					err: { file: "state.json", kind: "stateError", reason: "EACCES" },
					success: false,
				};
			},
		};

		const result = await deploy({
			config: twoPassConfig(),
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		assert(!result.success && result.err.kind === "stateWriteFailed");

		expect(result.err.unrecorded).toStrictEqual([created]);
		expect(result.err.unsavedState.resources).toStrictEqual([alreadyRecorded, created]);
	});

	it("should surface stateWriteFailed with the unsaved snapshot when persistence fails after a successful apply", async () => {
		expect.assertions(2);

		const created = vipPassCurrent();
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: created, success: true });
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create },
			place: placeStub,
			universe: universeStub,
		};
		const stateError = {
			file: ".bedrock/state/production.json",
			kind: "stateError" as const,
			reason: "EACCES",
		};
		const port: StatePort = {
			async read() {
				return { data: {}, success: true };
			},
			async write() {
				return { err: stateError, success: false };
			},
		};

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		expect(create).toHaveBeenCalledExactlyOnceWith(gamePassDesired());
		expect(result).toStrictEqual({
			err: {
				cause: stateError,
				kind: "stateWriteFailed",
				unrecorded: [created],
				unsavedState: { environment: "production", resources: [created], version: 1 },
			},
			success: false,
		});
	});

	it("should default-construct the state port from config.state when statePort is omitted", async () => {
		expect.assertions(2);

		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: vipPassCurrent(), success: true });
		const universeCreatedFixture = universeCurrent();
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create },
			place: placeStub,
			universe: {
				async create() {
					return { data: universeCreatedFixture, success: true };
				},
			},
		};

		const fetchSpy = vi.fn<GistFetch>(async () => {
			return new Response(JSON.stringify({ files: {} }), { status: 200 });
		});

		const result = await deploy({
			config: configWithState(),
			environment: "production",
			fetch: fetchSpy,
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			readFile: readIconAsync,
			registry,
		});

		assert(result.success);

		expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
		expect(result.data.environment).toBe("production");
	});

	it("should return Err(unknownEnvironment) when the environment is not declared in the config", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: vipPassConfig(),
			environment: "staging",
			readFile: readIconAsync,
			registry: stubRegistry(),
			statePort: inMemoryStatePort().port,
		});

		assert(!result.success);
		assert(result.err.kind === "unknownEnvironment");

		expect(result.err.environment).toBe("staging");
		expect(result.err.declared).toStrictEqual(["production"]);
	});

	it("should return Err(stateNotConfigured) when statePort is omitted and the config has no state for the environment", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: { environments: { production: {} }, passes: {} },
			environment: "production",
			getEnv: environmentFrom({}),
			readFile: readIconAsync,
			registry: stubRegistry(),
		});

		assert(!result.success);
		assert(result.err.kind === "stateNotConfigured");

		expect(result.err.kind).toBe("stateNotConfigured");
		expect(result.err.environment).toBe("production");
	});

	it("should return Err(unsupportedBackend) when config.state.backend is not a builtin and statePort is omitted", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: { environments: { production: {} }, state: { backend: "s3" } },
			environment: "production",
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			readFile: readIconAsync,
			registry: stubRegistry(),
		});

		assert(!result.success);
		assert(result.err.kind === "unsupportedBackend");

		expect(result.err.kind).toBe("unsupportedBackend");
		expect(result.err.backend).toBe("s3");
	});

	it("should persist state through a plugin-declared backend named by config.state.backend", async () => {
		expect.assertions(2);

		const written: Array<BedrockState> = [];

		const result = await deploy({
			config: {
				environments: { production: {} },
				state: { backend: "s3", bucket: "my-bucket" },
			},
			environment: "production",
			getEnv: environmentFrom({}),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createPort: ({ stateConfig }) => {
					return {
						data: {
							read: async () => ({ data: {}, success: true }),
							write: async (state) => {
								written.push({ ...state, environment: stateConfig.bucket });
								return { data: undefined, success: true };
							},
						},
						success: true,
					};
				},
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			readFile: readIconAsync,
			registry: stubRegistry(),
		});

		assert(result.success);

		expect(written).toHaveLength(1);
		expect(written[0]!.environment).toBe("my-bucket");
	});

	it("should resolve a plugin backend from opts.plugins when the config came from an injected loader", async () => {
		expect.assertions(1);

		const result = await deploy({
			environment: "production",
			getEnv: environmentFrom({}),
			loadConfig: async () => {
				return {
					data: {
						environments: { production: {} },
						state: { backend: "s3", bucket: "my-bucket" },
					},
					success: true,
				};
			},
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createPort: () => {
					return {
						data: {
							read: async () => ({ data: {}, success: true }),
							write: async () => ({ data: undefined, success: true }),
						},
						success: true,
					};
				},
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			readFile: readIconAsync,
			registry: stubRegistry(),
		});

		expect(result.success).toBeTrue();
	});

	it("should return Err(missingCredential) when BEDROCK_GITHUB_TOKEN is unset on the default-construction state-port path", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: configWithState(),
			environment: "production",
			getEnv: environmentFrom({}),
			readFile: readIconAsync,
			registry: stubRegistry(),
		});

		assert(!result.success);
		assert(result.err.kind === "missingCredential");

		expect(result.err.variable).toBe("BEDROCK_GITHUB_TOKEN");
		expect(result.err.purpose).toBe("stateBackend");
	});

	it("should default-construct the registry from BEDROCK_API_KEY when registry is omitted", async () => {
		expect.assertions(1);

		// Provide prior universe state so the diff is a noop and the real
		// universe driver default-constructed by the registry path never
		// reaches Open Cloud.
		const { port } = inMemoryStatePort({
			environment: "production",
			resources: [universeCurrent({ universeId: asRobloxAssetId("1") })],
			version: 1,
		});

		const result = await deploy({
			config: {
				environments: { production: {} },
				state: { backend: "gist", gistId: "abc" },
				universe: { universeId: "1" },
			},
			environment: "production",
			getEnv: environmentFrom({
				BEDROCK_API_KEY: "rbx-test",
				BEDROCK_GITHUB_TOKEN: "ghp_test",
			}),
			readFile: readIconAsync,
			statePort: port,
		});

		assert(result.success);

		expect(result.data.environment).toBe("production");
	});

	it("should return Err(missingCredential) when BEDROCK_API_KEY is unset on the default-construction registry path", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: {
				environments: { production: {} },
				state: { backend: "gist", gistId: "abc" },
				universe: { universeId: "1" },
			},
			environment: "production",
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			readFile: readIconAsync,
			statePort: inMemoryStatePort().port,
		});

		assert(!result.success);
		assert(result.err.kind === "missingCredential");

		expect(result.err.variable).toBe("BEDROCK_API_KEY");
		expect(result.err.purpose).toBe("registry");
	});

	it("should return Err(registryConfigMissing) when registry is omitted and config.universe is absent", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: {
				environments: { production: {} },
				state: { backend: "gist", gistId: "abc" },
			},
			environment: "production",
			getEnv: environmentFrom({
				BEDROCK_API_KEY: "rbx-test",
				BEDROCK_GITHUB_TOKEN: "ghp_test",
			}),
			readFile: readIconAsync,
			statePort: inMemoryStatePort().port,
		});

		assert(!result.success);
		assert(result.err.kind === "registryConfigMissing");

		expect(result.err.missing).toBe("universeId");
		expect(result.err.kind).toBe("registryConfigMissing");
	});

	it("should call the loadConfig override when config is omitted and use the result", async () => {
		expect.assertions(2);

		const minimalConfig: Config = {
			environments: { production: {} },
			state: { backend: "gist", gistId: "abc-test" },
		};
		const loadConfigStub = vi.fn<() => Promise<{ data: Config; success: true }>>(async () => {
			return { data: minimalConfig, success: true };
		});

		const result = await deploy({
			environment: "production",
			loadConfig: loadConfigStub,
			readFile: readIconAsync,
			registry: stubRegistry(),
			statePort: inMemoryStatePort().port,
		});

		expect(loadConfigStub).toHaveBeenCalledExactlyOnceWith();
		expect(result.success).toBeTrue();
	});

	it("should return Err(configLoadFailed) when the loadConfig override returns Err on the default-config path", async () => {
		expect.assertions(2);

		const configError = {
			kind: "fileNotFound" as const,
			searchedFrom: "/tmp",
		};

		const result = await deploy({
			environment: "production",
			loadConfig: async () => ({ err: configError, success: false }),
			readFile: readIconAsync,
			registry: stubRegistry(),
			statePort: inMemoryStatePort().port,
		});

		assert(!result.success);
		assert(result.err.kind === "configLoadFailed");

		expect(result.err.kind).toBe("configLoadFailed");
		expect(result.err.cause).toStrictEqual(configError);
	});

	it("should default getEnv to process.env when getEnv is not supplied", async () => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_API_KEY", "rbx-stub");

		// Prior universe state keeps the diff at noop so the
		// default-constructed universe driver never hits Open Cloud.
		const { port } = inMemoryStatePort({
			environment: "production",
			resources: [universeCurrent()],
			version: 1,
		});
		const result = await deploy({
			config: {
				environments: { production: {} },
				state: { backend: "gist", gistId: "abc" },
				universe: { universeId: "1234567890" },
			},
			environment: "production",
			readFile: readIconAsync,
			statePort: port,
		});

		expect(result.success).toBeTrue();
	});

	it("should not invoke getEnv when statePort, registry, config, and progress are all supplied", async () => {
		expect.assertions(1);

		const getEnvironment = vi.fn<(name: string) => string | undefined>();

		await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: getEnvironment,
			progress: { emit() {} },
			readFile: readIconAsync,
			registry: stubRegistryWithVipCreate(),
			statePort: inMemoryStatePort().port,
		});

		expect(getEnvironment).not.toHaveBeenCalled();
	});

	it("should surface buildDesiredFailed with iconRemovalRejected when prior state recorded a developer-product icon dropped from config", async () => {
		expect.assertions(4);

		const create = vi.fn<ResourceDriver<"developerProduct">["create"]>();
		const registry: DriverRegistry = {
			developerProduct: { create },
			gamePass: {
				create() {
					throw new Error("gamePass driver must not run for this fixture");
				},
			},
			place: placeStub,
			universe: universeStub,
		};
		const priorProduct = {
			key: asResourceKey("gem-pack"),
			name: "Gem Pack",
			description: "Stocks the player up with 1,000 premium gems.",
			icon: { "en-us": "assets/gem-pack.png" },
			iconFileHashes: { "en-us": ICON_HASH },
			isRegionalPricingEnabled: undefined,
			kind: "developerProduct" as const,
			outputs: { productId: asRobloxAssetId("8172635495") },
			price: undefined,
			storePageEnabled: undefined,
		};
		const { port, writes } = inMemoryStatePort({
			environment: "production",
			resources: [priorProduct],
			version: 1,
		});

		const result = await deploy({
			config: {
				environments: { production: {} },
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
					},
				},
			},
			environment: "production",
			readFile: readIconAsync,
			registry,
			statePort: port,
		});

		assert(!result.success);
		assert(result.err.kind === "buildDesiredFailed");
		assert(result.err.cause.kind === "iconRemovalRejected");

		expect(result.err.cause.key).toBe(priorProduct.key);
		expect(result.err.cause.message).toContain(priorProduct.key);
		expect(create).not.toHaveBeenCalled();
		expect(writes).toHaveLength(0);
	});

	it("should surface buildDesiredFailed without dispatching drivers or writing state when readFile rejects", async () => {
		expect.assertions(3);

		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const registry: DriverRegistry = {
			developerProduct: developerProductStub,
			gamePass: { create },
			place: placeStub,
			universe: universeStub,
		};
		const { port, writes } = inMemoryStatePort();
		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockRejectedValue(new Error("ENOENT"));

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			readFile,
			registry,
			statePort: port,
		});

		expect(create).not.toHaveBeenCalled();
		expect(writes).toHaveLength(0);
		expect(result).toStrictEqual({
			err: {
				cause: {
					key: asResourceKey("vip-pass"),
					filePath: "assets/vip-icon.png",
					kind: "fileReadFailed",
					reason: "ENOENT",
				},
				kind: "buildDesiredFailed",
			},
			success: false,
		});
	});

	describe("progress events", () => {
		function recordingProgress(): {
			calls: Array<ProgressEvent>;
			port: ProgressPort;
		} {
			const calls: Array<ProgressEvent> = [];
			return {
				calls,
				port: {
					emit(event) {
						calls.push(event);
					},
				},
			};
		}

		it("should emit stateWritten when statePort.write returns Ok", async () => {
			expect.assertions(1);

			const { port: statePort } = inMemoryStatePort();
			const { calls, port: progress } = recordingProgress();

			await deploy({
				config: vipPassConfig(),
				environment: "production",
				progress,
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			expect(calls).toContainEqual({ environment: "production", kind: "stateWritten" });
		});

		it("should not emit stateWritten when statePort.write returns Err", async () => {
			expect.assertions(2);

			const writeFailure: StatePort = {
				async read() {
					return { data: {}, success: true };
				},
				async write() {
					return {
						err: { file: "state.json", kind: "stateError", reason: "boom" },
						success: false,
					};
				},
			};
			const { calls, port: progress } = recordingProgress();

			const result = await deploy({
				config: vipPassConfig(),
				environment: "production",
				progress,
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort: writeFailure,
			});

			expect(result.success).toBeFalse();
			expect(calls.some((event) => event.kind === "stateWritten")).toBeFalse();
		});

		it("should thread the progress port through applyOps so per-resource events fire", async () => {
			expect.assertions(2);

			const { port: statePort } = inMemoryStatePort();
			const { calls, port: progress } = recordingProgress();

			await deploy({
				config: vipPassConfig(),
				environment: "production",
				progress,
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			expect(calls.some((event) => event.kind === "resourceOpStarted")).toBeTrue();
			expect(calls.some((event) => event.kind === "applySummary")).toBeTrue();
		});

		it("should emit exactly one deploySuccess event with environment and resourceCount on a successful reconcile", async () => {
			expect.assertions(1);

			const { port: statePort } = inMemoryStatePort();
			const { calls, port: progress } = recordingProgress();

			await deploy({
				config: vipPassConfig(),
				environment: "production",
				progress,
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			const terminal = calls.filter((event) => event.kind === "deploySuccess");

			expect(terminal).toStrictEqual([
				{ environment: "production", kind: "deploySuccess", resourceCount: 1 },
			]);
		});

		it.for<{
			arrange: () => Parameters<typeof deploy>[0];
			label: string;
			matchError: (error: DeployError) => boolean;
		}>([
			{
				arrange: () => {
					return {
						environment: "production",
						loadConfig: failingLoadConfigAsync,
						readFile: readIconAsync,
						registry: stubRegistry(),
						statePort: inMemoryStatePort().port,
					};
				},
				label: "configLoadFailed",
				matchError: (error) => error.kind === "configLoadFailed",
			},
			{
				arrange: () => {
					const stateError = {
						file: ".bedrock/state/production.json",
						kind: "stateError" as const,
						reason: "Corrupt JSON",
					};
					return {
						config: vipPassConfig(),
						environment: "production",
						readFile: readIconAsync,
						registry: stubRegistry(),
						statePort: {
							async read() {
								return { err: stateError, success: false };
							},
							async write() {
								return { data: undefined, success: true };
							},
						},
					};
				},
				label: "stateReadFailed",
				matchError: (error) => error.kind === "stateReadFailed",
			},
			{
				arrange: () => {
					const cause = new OpenCloudError("create vip-pass: 503");
					return {
						config: vipPassConfig(),
						environment: "production",
						readFile: readIconAsync,
						registry: {
							...stubRegistry(),
							gamePass: {
								async create() {
									return { err: cause, success: false };
								},
							},
						},
						statePort: inMemoryStatePort().port,
					};
				},
				label: "applyFailed",
				matchError: (error) => error.kind === "applyFailed",
			},
			{
				arrange: () => {
					const stateError = {
						file: ".bedrock/state/production.json",
						kind: "stateError" as const,
						reason: "EACCES",
					};
					return {
						config: vipPassConfig(),
						environment: "production",
						readFile: readIconAsync,
						registry: stubRegistryWithVipCreate(),
						statePort: {
							async read() {
								return { data: {}, success: true };
							},
							async write() {
								return { err: stateError, success: false };
							},
						},
					};
				},
				label: "stateWriteFailed",
				matchError: (error) => error.kind === "stateWriteFailed",
			},
		])(
			"should emit exactly one deployFailure event carrying the original $label error",
			async ({ arrange, matchError }) => {
				expect.assertions(2);

				const { calls, port: progress } = recordingProgress();
				const options = arrange();

				const result = await deploy({ ...options, progress });

				assert(!result.success);
				const failures = calls.filter((event) => event.kind === "deployFailure");

				expect(failures).toHaveLength(1);

				const [failure] = failures;
				assert(failure !== undefined);

				expect(matchError(failure.error) && failure.error === result.err).toBeTrue();
			},
		);

		it("should pass the environment name verbatim through the deployFailure event", async () => {
			expect.assertions(1);

			const { calls, port: progress } = recordingProgress();

			await deploy({
				config: vipPassConfig(),
				environment: "ghost",
				progress,
				readFile: readIconAsync,
				registry: stubRegistry(),
				statePort: inMemoryStatePort().port,
			});

			const failures = calls.filter((event) => event.kind === "deployFailure");

			expect(failures.map((event) => event.environment)).toStrictEqual(["ghost"]);
		});
	});

	describe("default port resolution", () => {
		it("should not consult BEDROCK_CLI when an explicit progress port is supplied", async () => {
			expect.assertions(2);

			const { port: statePort } = inMemoryStatePort();
			const calls: Array<ProgressEvent> = [];
			const progress: ProgressPort = {
				emit(event) {
					calls.push(event);
				},
			};
			const getEnvironment = vi.fn<(name: string) => string | undefined>(
				environmentFrom({ BEDROCK_API_KEY: "rbx-test" }),
			);

			await deploy({
				config: vipPassConfig(),
				environment: "production",
				getEnv: getEnvironment,
				progress,
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			expect(calls.some((event) => event.kind === "deploySuccess")).toBeTrue();
			expect(getEnvironment.mock.calls.some(([name]) => name === "BEDROCK_CLI")).toBeFalse();
		});

		it("should consult getEnv with 'BEDROCK_CLI' when progress is omitted", async () => {
			expect.assertions(1);

			const { port: statePort } = inMemoryStatePort();
			const getEnvironment = vi.fn<(name: string) => string | undefined>(
				environmentFrom({ BEDROCK_API_KEY: "rbx-test" }),
			);

			await deploy({
				config: vipPassConfig(),
				environment: "production",
				getEnv: getEnvironment,
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			expect(getEnvironment.mock.calls.some(([name]) => name === "BEDROCK_CLI")).toBeTrue();
		});

		it("should default to the clack adapter when progress is omitted and BEDROCK_CLI is set", async () => {
			expect.assertions(1);

			const { stdout } = captureStreams();
			const { port: statePort } = inMemoryStatePort();

			await deploy({
				config: vipPassConfig(),
				environment: "production",
				getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test", BEDROCK_CLI: "1" }),
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			expect(stdout.join("")).toContain("production: 1 resources reconciled");
		});

		it("should render stateWritten with the loaded backend label when options.config is omitted but loadConfig succeeds and BEDROCK_CLI is set", async () => {
			expect.assertions(1);

			const { stdout } = captureStreams();
			const loadedConfig: Config = {
				environments: { production: {} },
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip-icon.png" },
						price: 500,
					},
				},
				state: { backend: "gist", gistId: "abc-test" },
			};
			const { port: statePort } = inMemoryStatePort();

			await deploy({
				environment: "production",
				getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test", BEDROCK_CLI: "1" }),
				loadConfig: async () => ({ data: loadedConfig, success: true }),
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			expect(stdout.join("")).toContain("State written to gist:abc-test");
		});

		it("should surface resolveDeps failure through the default clack path when BEDROCK_CLI is set", async () => {
			expect.assertions(1);

			captureStreams();

			const result = await deploy({
				config: vipPassConfig(),
				environment: "ghost",
				getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test", BEDROCK_CLI: "1" }),
				readFile: readIconAsync,
				registry: stubRegistry(),
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("unknownEnvironment");
		});

		it("should default to a no-op port when progress is omitted and BEDROCK_CLI is unset", async () => {
			expect.assertions(1);

			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			try {
				const { port: statePort } = inMemoryStatePort();

				await deploy({
					config: vipPassConfig(),
					environment: "production",
					getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test" }),
					readFile: readIconAsync,
					registry: stubRegistryWithVipCreate(),
					statePort,
				});
			} finally {
				writeSpy.mockRestore();
			}

			expect(writeSpy).not.toHaveBeenCalled();
		});

		it("should default to a no-op port when progress is omitted and BEDROCK_CLI is empty string", async () => {
			expect.assertions(1);

			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			try {
				const { port: statePort } = inMemoryStatePort();

				await deploy({
					config: vipPassConfig(),
					environment: "production",
					getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test", BEDROCK_CLI: "" }),
					readFile: readIconAsync,
					registry: stubRegistryWithVipCreate(),
					statePort,
				});
			} finally {
				writeSpy.mockRestore();
			}

			expect(writeSpy).not.toHaveBeenCalled();
		});
	});

	describe("codegen", () => {
		it("should write the files the emitter returns through the injected writer", async () => {
			expect.assertions(1);

			const writer = inMemoryCodegenWriter();
			const result = await deploy({
				codegenWriter: writer.port,
				config: codegenVipConfig(),
				emit: vi.fn<Emitter>().mockResolvedValue([CODEGEN_FILE]),
				environment: "production",
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(writer.writes).toStrictEqual([CODEGEN_FILE]);
		});

		it("should hand the emitter the deployed state and present a never-deployed environment as empty", async () => {
			expect.assertions(2);

			const created = vipPassCurrent();
			const inputs: Array<EmitInput> = [];
			const emit = vi.fn<Emitter>(async (input) => {
				inputs.push(input);
				return [];
			});

			await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: {
					codegen: { enabled: true, output: "src/generated" },
					environments: { production: {}, staging: {} },
					passes: { "vip-pass": VipPassEntry },
				},
				emit,
				environment: "production",
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort: environmentAwareStatePort({}),
			});

			expect(inputs[0]!.environments["production"]!.resources).toStrictEqual([created]);
			expect(inputs[0]!.environments["staging"]).toStrictEqual({
				environment: "staging",
				resources: [],
				version: 1,
			});
		});

		it("should not run codegen when the config does not enable it", async () => {
			expect.assertions(2);

			const writer = inMemoryCodegenWriter();
			const emit = vi.fn<Emitter>();
			const result = await deploy({
				codegenWriter: writer.port,
				config: vipPassConfig(),
				emit,
				environment: "production",
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(emit).not.toHaveBeenCalled();
			expect(writer.writes).toBeEmpty();
		});

		it("should write the default Luau module when enabled with no emitter supplied", async () => {
			expect.assertions(2);

			const writer = inMemoryCodegenWriter();
			const result = await deploy({
				codegenWriter: writer.port,
				config: codegenVipConfig("src/generated"),
				environment: "production",
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(writer.writes.map((file) => file.path)).toStrictEqual(["resources.luau"]);
			expect(writer.writes[0]!.content).toContain("assetId = 9876543210");
		});

		it("should also write the type-declaration companion when the config opts in", async () => {
			expect.assertions(1);

			const writer = inMemoryCodegenWriter();
			await deploy({
				codegenWriter: writer.port,
				config: {
					codegen: { enabled: true, typeDeclarations: true },
					environments: { production: {} },
					passes: { "vip-pass": VipPassEntry },
				},
				environment: "production",
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort: inMemoryStatePort().port,
			});

			expect(writer.writes.map((file) => file.path)).toStrictEqual([
				"resources.luau",
				"resources.d.ts",
			]);
		});

		it("should emit only the resolved keys and still return applyFailed on a partial apply", async () => {
			expect.assertions(3);

			const alphaCurrent = alphaPassCurrent();
			const cause = new OpenCloudError("create vip-pass: 503");
			const create = vi
				.fn<ResourceDriver<"gamePass">["create"]>()
				.mockImplementation(
					outcomeByKey({ "alpha-pass": alphaCurrent, "vip-pass": cause }),
				);
			const inputs: Array<EmitInput> = [];
			const emit = vi.fn<Emitter>(async (input) => {
				inputs.push(input);
				return [CODEGEN_FILE];
			});
			const writer = inMemoryCodegenWriter();

			const result = await deploy({
				codegenWriter: writer.port,
				config: { ...twoPassConfig(), codegen: { enabled: true, output: "src/generated" } },
				emit,
				environment: "production",
				readFile: readIconAsync,
				registry: {
					developerProduct: developerProductStub,
					gamePass: { create },
					place: placeStub,
					universe: universeStub,
				},
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("applyFailed");
			expect(inputs[0]!.environments["production"]!.resources).toStrictEqual([alphaCurrent]);
			expect(writer.writes).toStrictEqual([CODEGEN_FILE]);
		});

		it("should surface codegenFailed when the writer rejects on an otherwise successful deploy", async () => {
			expect.assertions(1);

			const writer: CodegenWriterPort = {
				async write() {
					return {
						err: {
							kind: "codegenWriteError",
							path: "out/ids.luau",
							reason: "no space",
						},
						success: false,
					};
				},
			};
			const result = await deploy({
				codegenWriter: writer,
				config: codegenVipConfig(),
				emit: vi.fn<Emitter>().mockResolvedValue([CODEGEN_FILE]),
				environment: "production",
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);
			assert(result.err.kind === "codegenFailed");

			expect(result.err.cause.kind).toBe("codegenWriteFailed");
		});

		it("should default the output directory when enabled with no writer or output configured", async () => {
			expect.assertions(1);

			const emit = vi.fn<Emitter>().mockResolvedValue([]);
			const result = await deploy({
				config: codegenVipConfig(),
				emit,
				environment: "production",
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(emit).toHaveBeenCalledExactlyOnceWith({
				environments: {
					production: {
						environment: "production",
						resources: [vipPassCurrent()],
						version: 1,
					},
				},
			});
		});

		it("should default to a node-fs writer rooted at the configured output when none is injected", async () => {
			expect.assertions(1);

			const emit = vi.fn<Emitter>().mockResolvedValue([]);
			const result = await deploy({
				config: codegenVipConfig("src/generated"),
				emit,
				environment: "production",
				readFile: readIconAsync,
				registry: stubRegistryWithVipCreate(),
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(emit).toHaveBeenCalledExactlyOnceWith({
				environments: {
					production: {
						environment: "production",
						resources: [vipPassCurrent()],
						version: 1,
					},
				},
			});
		});
	});

	describe("fused deploy", () => {
		const startPlace = asResourceKey("start-place");

		interface PlaceCall {
			readonly key: ResourceKey;
			readonly artifact: Uint8Array | undefined;
			readonly type: "create" | "update";
		}

		function recordingPlaceRegistry(): {
			placeCalls: Array<PlaceCall>;
			registry: DriverRegistry;
		} {
			const placeCalls: Array<PlaceCall> = [];
			const place: ResourceDriver<"place"> = {
				async create(desired, context) {
					placeCalls.push({
						key: desired.key,
						artifact: context?.artifact,
						type: "create",
					});
					return { data: { ...desired, outputs: { versionNumber: 1 } }, success: true };
				},
				// eslint-disable-next-line better-max-params/better-max-params -- ResourceDriver.update port contract.
				async update(_current, desired, context) {
					placeCalls.push({
						key: desired.key,
						artifact: context?.artifact,
						type: "update",
					});
					return { data: { ...desired, outputs: { versionNumber: 2 } }, success: true };
				},
			};
			return {
				placeCalls,
				registry: {
					developerProduct: developerProductStub,
					gamePass: {
						async create() {
							return { data: vipPassCurrent(), success: true };
						},
					},
					place,
					universe: universeStub,
				},
			};
		}

		function recordingBuildStep(): { builds: Array<string>; step: BuildStep } {
			const builds: Array<string> = [];
			return {
				builds,
				step: async ({ environment }) => {
					builds.push(environment);
				},
			};
		}

		function fusedConfig(): Config {
			return {
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				passes: { "vip-pass": VipPassEntry },
				places: { "start-place": { filePath: "places/start.rbxl" } },
			};
		}

		function fusedEmit(): ReadonlyArray<CodegenFile> {
			return [CODEGEN_FILE];
		}

		function withCodegen(config: Config): Config {
			return { ...config, codegen: { enabled: true, output: "src/generated" } };
		}

		function fusedCodegenConfig(): Config {
			return withCodegen(fusedConfig());
		}

		function startPlaceInState(): ResourceCurrentState<"place"> {
			return {
				key: startPlace,
				description: undefined,
				displayName: undefined,
				fileHash: ICON_HASH,
				filePath: "places/start.rbxl",
				kind: "place",
				outputs: { versionNumber: 1 },
				placeId: asRobloxAssetId("4711"),
				serverSize: undefined,
			};
		}

		function markedPriorState(): BedrockState {
			return {
				environment: "production",
				pendingRebuild: new Set([startPlace]),
				resources: [vipPassCurrent(), startPlaceInState()],
				version: 1,
			};
		}

		function stalePlaceInState(): ResourceCurrentState<"place"> {
			// A fileHash that cannot match readIcon's empty-bytes digest, so the
			// diff dispatches an update (the on-disk artifact changed).
			return {
				...startPlaceInState(),
				fileHash: asSha256Hex(
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				),
			};
		}

		it("should publish the on-disk artifact after provision and build with a single build invocation", async () => {
			expect.assertions(5);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();

			const result = await deploy({
				build: step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(builds).toStrictEqual(["production"]);
			expect(writes).toHaveLength(2);
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
			expect(writes[1]!.pendingRebuild).toBeUndefined();
			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: undefined, type: "create" },
			]);
		});

		it("should run provision, codegen, build, and publish in that order", async () => {
			expect.assertions(1);

			const events: Array<string> = [];
			const { registry } = recordingPlaceRegistry();
			const place: ResourceDriver<"place"> = {
				async create(desired) {
					events.push("publish");
					return { data: { ...desired, outputs: { versionNumber: 1 } }, success: true };
				},
			};

			const result = await deploy({
				build: async () => {
					events.push("build");
				},
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: () => {
					events.push("codegen");
					return [CODEGEN_FILE];
				},
				environment: "production",
				readFile: readIconAsync,
				registry: { ...registry, place },
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(events).toStrictEqual(["codegen", "build", "publish"]);
		});

		it("should surface missingBuildStep and mint nothing when codegen is enabled with no build step", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("missingBuildStep");
			expect(writes).toBeEmpty();
			expect(placeCalls).toBeEmpty();
		});

		it("should deploy without a build step when codegen is enabled and every place is config-only", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: withCodegen({
					environments: {
						production: { places: { "start-place": { placeId: "4711" } } },
					},
					passes: { "vip-pass": VipPassEntry },
					places: { "start-place": { displayName: "Start Place" } },
				}),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(placeCalls.map((call) => call.type)).toStrictEqual(["create"]);
			expect(writes[0]!.pendingRebuild).toBeUndefined();
			expect(writes[0]!.resources.map((resource) => resource.key)).toContain(startPlace);
		});

		it("should mark only the buildable place when a config-only place sits beside it", async () => {
			expect.assertions(3);

			const lobby = asResourceKey("lobby");
			const { port, writes } = inMemoryStatePort();
			const { registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();

			const result = await deploy({
				build: step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: withCodegen({
					environments: {
						production: {
							places: {
								"lobby": { placeId: "9999" },
								"start-place": { placeId: "4711" },
							},
						},
					},
					passes: { "vip-pass": VipPassEntry },
					places: {
						"lobby": { displayName: "Lobby" },
						"start-place": { filePath: "places/start.rbxl" },
					},
				}),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(result.success);

			// The provision checkpoint marks the buildable place alone; the
			// config-only place is already applied by then.
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
			expect(writes[0]!.resources.map((resource) => resource.key)).toContain(lobby);
			expect(builds).toStrictEqual(["production"]);
		});

		it("should publish places in a single pass without invoking the build step when codegen is not enabled", async () => {
			expect.assertions(4);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();

			const result = await deploy({
				build: step,
				config: fusedConfig(),
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(builds).toBeEmpty();
			expect(writes).toHaveLength(1);
			expect(writes[0]!.pendingRebuild).toBeUndefined();
			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: undefined, type: "create" },
			]);
		});

		it("should surface buildFailed with the checkpoint marker persisted when the build step throws", async () => {
			expect.assertions(5);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				build: () => {
					throw new Error("build blew up");
				},
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(!result.success);
			assert(result.err.kind === "buildFailed");

			expect(result.err.reason).toBe("build blew up");
			expect(writes).toHaveLength(1);
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
			expect(writes[0]!.resources).toContainEqual(vipPassCurrent());
			expect(placeCalls).toBeEmpty();
		});

		it("should stringify a non-Error thrown by the build step into the failure reason", async () => {
			expect.assertions(1);

			const result = await deploy({
				build: vi.fn<BuildStep>().mockRejectedValue("kaboom"),
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry: recordingPlaceRegistry().registry,
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);
			assert(result.err.kind === "buildFailed");

			expect(result.err.reason).toBe("kaboom");
		});

		it("should carry the thrown error's cause chain into the failure reason", async () => {
			expect.assertions(1);

			const result = await deploy({
				build: () => {
					throw new Error("bundling failed", {
						cause: new Error("esbuild: unexpected token"),
					});
				},
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry: recordingPlaceRegistry().registry,
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);
			assert(result.err.kind === "buildFailed");

			expect(result.err.reason).toBe("bundling failed; caused by: esbuild: unexpected token");
		});

		it("should retain the stored codegen hash on the checkpoint when the build step fails", async () => {
			expect.assertions(3);

			const storedHash = asSha256Hex(
				"1111111111111111111111111111111111111111111111111111111111111111",
			);
			const { port, writes } = inMemoryStatePort({
				codegenHash: storedHash,
				environment: "production",
				resources: [vipPassCurrent(), startPlaceInState()],
				version: 1,
			});

			const result = await deploy({
				build: () => {
					throw new Error("build blew up");
				},
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry: recordingPlaceRegistry().registry,
				statePort: port,
			});

			assert(!result.success);
			assert(result.err.kind === "buildFailed");

			expect(writes).toHaveLength(1);
			expect(writes[0]!.codegenHash).toBe(storedHash);
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
		});

		it("should self-heal a marker left by a failed run on the next green deploy", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort({
				...markedPriorState(),
				resources: [vipPassCurrent(), stalePlaceInState()],
			});
			const { placeCalls, registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();

			const result = await deploy({
				build: step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(builds).toStrictEqual(["production"]);
			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: undefined, type: "update" },
			]);
			expect(writes.at(-1)!.pendingRebuild).toBeUndefined();
		});

		it("should not invoke the build step when the asset stage apply fails", async () => {
			expect.assertions(3);

			const { placeCalls, registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();
			const failingRegistry: DriverRegistry = {
				...registry,
				gamePass: {
					async create() {
						return { err: new OpenCloudError("create vip-pass: 503"), success: false };
					},
				},
			};

			const result = await deploy({
				build: step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry: failingRegistry,
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("applyFailed");
			expect(builds).toBeEmpty();
			expect(placeCalls).toBeEmpty();
		});

		it("should not invoke the build step when the checkpoint write fails", async () => {
			expect.assertions(3);

			const { placeCalls, registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();
			const port: StatePort = {
				async read() {
					return { data: {}, success: true };
				},
				async write() {
					return {
						err: { file: "state.json", kind: "stateError", reason: "EACCES" },
						success: false,
					};
				},
			};

			const result = await deploy({
				build: step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("stateWriteFailed");
			expect(builds).toBeEmpty();
			expect(placeCalls).toBeEmpty();
		});

		it("should run codegen with the minted IDs before the build step", async () => {
			expect.assertions(2);

			const inputs: Array<EmitInput> = [];
			const writer = inMemoryCodegenWriter();
			const { registry } = recordingPlaceRegistry();

			await deploy({
				build: recordingBuildStep().step,
				codegenWriter: writer.port,
				config: fusedCodegenConfig(),
				emit: (input) => {
					inputs.push(input);
					return [CODEGEN_FILE];
				},
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: inMemoryStatePort().port,
			});

			expect(inputs[0]!.environments["production"]!.resources).toContainEqual(
				vipPassCurrent(),
			);
			expect(writer.writes).toStrictEqual([CODEGEN_FILE]);
		});

		it("should abort before the build step and surface codegenFailed when codegen fails", async () => {
			expect.assertions(4);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();
			const rejectingWriter: CodegenWriterPort = {
				async write() {
					return {
						err: { kind: "codegenWriteError", path: "ids.luau", reason: "no space" },
						success: false,
					};
				},
			};

			const result = await deploy({
				build: step,
				codegenWriter: rejectingWriter,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(!result.success);
			assert(result.err.kind === "codegenFailed");

			expect(builds).toBeEmpty();
			expect(placeCalls).toBeEmpty();
			expect(writes).toHaveLength(1);
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
		});

		it("should emit codegen for resolved keys only on a partial asset failure", async () => {
			expect.assertions(4);

			const inputs: Array<EmitInput> = [];
			const writer = inMemoryCodegenWriter();
			const { registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();
			const partialRegistry: DriverRegistry = {
				...registry,
				gamePass: {
					create: outcomeByKey({
						"alpha-pass": new OpenCloudError("create alpha-pass: 503"),
						"vip-pass": vipPassCurrent(),
					}),
				},
			};

			const result = await deploy({
				build: step,
				codegenWriter: writer.port,
				config: withCodegen({
					environments: {
						production: { places: { "start-place": { placeId: "4711" } } },
					},
					passes: {
						"alpha-pass": {
							name: "Alpha Pass",
							description: "Grants alpha perks.",
							icon: { "en-us": "assets/alpha-icon.png" },
							price: 250,
						},
						"vip-pass": VipPassEntry,
					},
					places: { "start-place": { filePath: "places/start.rbxl" } },
				}),
				emit: (input) => {
					inputs.push(input);
					return [CODEGEN_FILE];
				},
				environment: "production",
				readFile: readIconAsync,
				registry: partialRegistry,
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("applyFailed");
			expect(builds).toBeEmpty();
			expect(inputs[0]!.environments["production"]!.resources).toContainEqual(
				vipPassCurrent(),
			);
			expect(inputs[0]!.environments["production"]!.resources).not.toContainEqual(
				alphaPassCurrent(),
			);
		});

		it("should upload nothing and clear the marker when nothing changed on a green fused deploy", async () => {
			expect.assertions(4);

			const { port, writes } = inMemoryStatePort(markedPriorState());
			const { placeCalls, registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();

			const result = await deploy({
				build: step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(builds).toStrictEqual(["production"]);
			expect(placeCalls).toBeEmpty();
			expect(writes).toHaveLength(2);
			expect(writes.at(-1)!.pendingRebuild).toBeUndefined();
		});

		it("should surface stateReadFailed when the publish-stage reload fails after a green build", async () => {
			expect.assertions(2);

			const { builds, step } = recordingBuildStep();
			const reads = resultsInOrder<Result<StateRecord, StateError>>([
				{ data: {}, success: true },
				{ err: { file: "state.json", kind: "stateError", reason: "EIO" }, success: false },
			]);
			const port: StatePort = {
				read: reads,
				async write() {
					return { data: undefined, success: true };
				},
			};

			const result = await deploy({
				build: step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry: recordingPlaceRegistry().registry,
				statePort: port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("stateReadFailed");
			expect(builds).toStrictEqual(["production"]);
		});

		it("should keep the marker for a place whose publish fails", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort({
				environment: "production",
				resources: [vipPassCurrent(), stalePlaceInState()],
				version: 1,
			});
			const { registry } = recordingPlaceRegistry();
			const failingPlaceRegistry: DriverRegistry = {
				...registry,
				place: {
					async create() {
						return {
							err: new OpenCloudError("create start-place: 503"),
							success: false,
						};
					},
					async update() {
						return {
							err: new OpenCloudError("update start-place: 503"),
							success: false,
						};
					},
				},
			};

			const result = await deploy({
				build: recordingBuildStep().step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry: failingPlaceRegistry,
				statePort: port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("applyFailed");
			expect(writes).toHaveLength(2);
			expect(writes.at(-1)!.pendingRebuild).toStrictEqual(new Set([startPlace]));
		});

		it("should build once and publish every declared place for a multi-place universe", async () => {
			expect.assertions(4);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();
			const { builds, step } = recordingBuildStep();

			const result = await deploy({
				build: step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: withCodegen({
					environments: {
						production: {
							places: { arena: { placeId: "200" }, lobby: { placeId: "100" } },
						},
					},
					passes: { "vip-pass": VipPassEntry },
					places: {
						arena: { filePath: "places/arena.rbxl" },
						lobby: { filePath: "places/lobby.rbxl" },
					},
				}),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(builds).toStrictEqual(["production"]);
			expect(placeCalls).toContainEqual({
				key: asResourceKey("lobby"),
				artifact: undefined,
				type: "create",
			});
			expect(placeCalls).toContainEqual({
				key: asResourceKey("arena"),
				artifact: undefined,
				type: "create",
			});
			expect(writes.at(-1)!.pendingRebuild).toBeUndefined();
		});

		it("should preserve the stored codegen hash across a green fused deploy", async () => {
			expect.assertions(1);

			const storedHash = asSha256Hex(
				"2222222222222222222222222222222222222222222222222222222222222222",
			);
			const { port, writes } = inMemoryStatePort({
				codegenHash: storedHash,
				environment: "production",
				resources: [vipPassCurrent(), startPlaceInState()],
				version: 1,
			});

			const result = await deploy({
				build: recordingBuildStep().step,
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readIconAsync,
				registry: recordingPlaceRegistry().registry,
				statePort: port,
			});

			assert(result.success);

			expect(writes.at(-1)!.codegenHash).toBe(storedHash);
		});

		function collisionConfig(): Config {
			// A game pass sharing the place's key: the marker stores bare keys,
			// so settling must only consider place survivors and place noops.
			return {
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				passes: { "start-place": VipPassEntry },
				places: { "start-place": { filePath: "places/start.rbxl" } },
			};
		}

		function collidingPassCurrent(price: number) {
			return { ...vipPassCurrent(), key: startPlace, price };
		}

		function failingPlaceDriver(): ResourceDriver<"place"> {
			return {
				async create() {
					return { err: new OpenCloudError("create start-place: 503"), success: false };
				},
				async update() {
					return { err: new OpenCloudError("update start-place: 503"), success: false };
				},
			};
		}

		it("should read the place artifact only in the publish stage and asset files only in provision", async () => {
			expect.assertions(4);

			const order: Array<string> = [];

			async function readRecordingAsync(path: string): Promise<Uint8Array> {
				order.push(path);
				return ICON_BYTES;
			}

			const { registry } = recordingPlaceRegistry();

			const result = await deploy({
				build: async () => {
					order.push("build");
				},
				codegenWriter: inMemoryCodegenWriter().port,
				config: fusedCodegenConfig(),
				emit: fusedEmit,
				environment: "production",
				readFile: readRecordingAsync,
				registry,
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(order.filter((entry) => entry === "assets/vip-icon.png")).toHaveLength(1);
			expect(order.filter((entry) => entry === "places/start.rbxl")).toHaveLength(1);
			expect(order.indexOf("assets/vip-icon.png")).toBeLessThan(order.indexOf("build"));
			expect(order.indexOf("places/start.rbxl")).toBeGreaterThan(order.indexOf("build"));
		});

		it("should keep the marker when a game pass sharing the place's key republishes but the place fails", async () => {
			expect.assertions(2);

			const { port, writes } = inMemoryStatePort({
				environment: "production",
				pendingRebuild: new Set([startPlace]),
				resources: [collidingPassCurrent(250), stalePlaceInState()],
				version: 1,
			});
			const registry: DriverRegistry = {
				developerProduct: developerProductStub,
				gamePass: {
					async create() {
						return { data: collidingPassCurrent(500), success: true };
					},
					async update() {
						return { data: collidingPassCurrent(500), success: true };
					},
				},
				place: failingPlaceDriver(),
				universe: universeStub,
			};

			const result = await deploy({
				config: collisionConfig(),
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("applyFailed");
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
		});

		it("should keep the marker when a game pass sharing the place's key noop's but the place fails", async () => {
			expect.assertions(2);

			const { port, writes } = inMemoryStatePort({
				environment: "production",
				pendingRebuild: new Set([startPlace]),
				resources: [collidingPassCurrent(500), stalePlaceInState()],
				version: 1,
			});
			const registry: DriverRegistry = {
				...stubRegistry(),
				place: failingPlaceDriver(),
			};

			const result = await deploy({
				config: collisionConfig(),
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("applyFailed");
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
		});

		it("should publish the marked place and clear a leftover marker in a no-codegen deploy", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort({
				...markedPriorState(),
				resources: [vipPassCurrent(), stalePlaceInState()],
			});
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				config: fusedConfig(),
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: undefined, type: "update" },
			]);
			expect(writes).toHaveLength(1);
			expect(writes[0]!.pendingRebuild).toBeUndefined();
		});

		it("should clear a leftover marker when the marked place is already up to date in a no-codegen deploy", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort(markedPriorState());
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				config: fusedConfig(),
				environment: "production",
				readFile: readIconAsync,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(placeCalls).toBeEmpty();
			expect(writes).toHaveLength(1);
			expect(writes[0]!.pendingRebuild).toBeUndefined();
		});

		it("should keep a leftover marker for a place whose publish fails in a no-codegen deploy", async () => {
			expect.assertions(2);

			const { port, writes } = inMemoryStatePort({
				...markedPriorState(),
				resources: [vipPassCurrent(), stalePlaceInState()],
			});
			const { registry } = recordingPlaceRegistry();
			const failingPlaceRegistry: DriverRegistry = {
				...registry,
				place: {
					async create() {
						return {
							err: new OpenCloudError("create start-place: 503"),
							success: false,
						};
					},
					async update() {
						return {
							err: new OpenCloudError("update start-place: 503"),
							success: false,
						};
					},
				},
			};

			const result = await deploy({
				config: fusedConfig(),
				environment: "production",
				readFile: readIconAsync,
				registry: failingPlaceRegistry,
				statePort: port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("applyFailed");
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
		});
	});
});

describe(isCliEnvironmentFlagSet, () => {
	it("should return false when value is undefined", () => {
		expect.assertions(1);

		expect(isCliEnvironmentFlagSet(undefined)).toBeFalse();
	});

	it("should return false when value is the empty string", () => {
		expect.assertions(1);

		expect(isCliEnvironmentFlagSet("")).toBeFalse();
	});

	it("should return true when value is a single non-empty character", () => {
		expect.assertions(1);

		expect(isCliEnvironmentFlagSet("1")).toBeTrue();
	});

	it("should return true when value is the literal '0' since only the empty string is rejected", () => {
		expect.assertions(1);

		expect(isCliEnvironmentFlagSet("0")).toBeTrue();
	});

	it("should return true when value is a single-space string since only the empty string is rejected", () => {
		expect.assertions(1);

		expect(isCliEnvironmentFlagSet(" ")).toBeTrue();
	});

	it("should return true when value is a multi-character non-empty string", () => {
		expect.assertions(1);

		expect(isCliEnvironmentFlagSet("true")).toBeTrue();
	});
});
