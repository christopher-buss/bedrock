import { OpenCloudError } from "@bedrock-rbx/ocale";

import { placeCurrent, universeCurrent } from "#tests/helpers/resources";
import { Buffer } from "node:buffer";
import process from "node:process";
import { assert, describe, expect, it, vi } from "vitest";

import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { CodegenFile, EmitInput, Emitter } from "../core/codegen.ts";
import { hashCodegenFiles } from "../core/codegen.ts";
import type { RebuildHook, RebuiltPlace } from "../core/rebuild.ts";
import { UNIVERSE_SINGLETON_KEY } from "../core/resources.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { ProgressEvent, ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex, type ResourceKey } from "../types/ids.ts";
import { deploy, type DeployError, isCliEnvironmentFlagSet } from "./deploy.ts";

// Empty bytes hash to SHA-256 `e3b0c44...`; keeping readIcon in lockstep with
// the hash constant lets the noop test assert "desired matches current" without
// recomputing digests at runtime.
const ICON_BYTES = new Uint8Array();
const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

async function readIcon(): Promise<Uint8Array> {
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
				return { data: current, success: true };
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

function environmentFrom(values: Record<string, string>): (name: string) => string | undefined {
	return (name) => values[name];
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

async function failingLoadConfig(): Promise<{
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
			return { data: store.get(environment), success: true };
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
			readFile: readIcon,
			registry,
			statePort: port,
		});

		assert(result.success);

		expect(universeCreate).toHaveBeenCalledOnce();
		expect(placeCreate).toHaveBeenCalledOnce();
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
			readFile: readIcon,
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
			readFile: readIcon,
			registry,
			statePort: port,
		});

		expect(create).toHaveBeenCalledOnce();
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
			readFile: readIcon,
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
			readFile: readIcon,
			registry,
			statePort: port,
		});

		expect(update).toHaveBeenCalledOnce();
		expect(writes[0]!.resources).toStrictEqual([updated]);
		expect(result).toStrictEqual({ data: writes[0], success: true });
	});

	it("should persist the partial-apply snapshot and surface applyFailed when a driver fails mid-sequence", async () => {
		expect.assertions(4);

		const alphaCurrent = alphaPassCurrent();
		const cause = new OpenCloudError("create vip-pass: 503");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementation(async (desired) => {
				if (desired.key === "alpha-pass") {
					return { data: alphaCurrent, success: true };
				}

				return { err: cause, success: false };
			});
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
			readFile: readIcon,
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
			.mockImplementation(async (desired) => {
				if (desired.key === "alpha-pass") {
					return { data: alphaCurrent, success: true };
				}

				return { err: cause, success: false };
			});
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
			readFile: readIcon,
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
			readFile: readIcon,
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
			.mockImplementation(async (desired) => {
				if (desired.key === "alpha-pass") {
					return { data: alphaCurrent, success: true };
				}

				return { err: cause, success: false };
			});
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
				return { data: undefined, success: true };
			},
			async write(state) {
				writeAttempts.push(state);
				return { err: stateError, success: false };
			},
		};

		const result = await deploy({
			config: twoPassConfig(),
			environment: "production",
			readFile: readIcon,
			registry,
			statePort: port,
		});

		expect(writeAttempts).toHaveLength(1);
		expect(writeAttempts[0]!.resources).toStrictEqual([alphaCurrent]);
		expect(result).toStrictEqual({
			err: {
				cause: stateError,
				kind: "stateWriteFailed",
				unsavedState: {
					environment: "production",
					resources: [alphaCurrent],
					version: 1,
				},
			},
			success: false,
		});
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
				return { data: undefined, success: true };
			},
			async write() {
				return { err: stateError, success: false };
			},
		};

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIcon,
			registry,
			statePort: port,
		});

		expect(create).toHaveBeenCalledOnce();
		expect(result).toStrictEqual({
			err: {
				cause: stateError,
				kind: "stateWriteFailed",
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

		const fetchSpy = vi.fn<GistFetch>(async (_input, init) => {
			if (init?.method === "PATCH") {
				return new Response(JSON.stringify({ files: {} }), { status: 200 });
			}

			return new Response(JSON.stringify({ files: {} }), { status: 200 });
		});

		const result = await deploy({
			config: configWithState(),
			environment: "production",
			fetch: fetchSpy,
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			readFile: readIcon,
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
			readFile: readIcon,
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
			readFile: readIcon,
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
			readFile: readIcon,
			registry: stubRegistry(),
		});

		assert(!result.success);
		assert(result.err.kind === "unsupportedBackend");

		expect(result.err.kind).toBe("unsupportedBackend");
		expect(result.err.backend).toBe("s3");
	});

	it("should return Err(missingCredential) when BEDROCK_GITHUB_TOKEN is unset on the default-construction state-port path", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: configWithState(),
			environment: "production",
			getEnv: environmentFrom({}),
			readFile: readIcon,
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
			readFile: readIcon,
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
			readFile: readIcon,
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
			readFile: readIcon,
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
			readFile: readIcon,
			registry: stubRegistry(),
			statePort: inMemoryStatePort().port,
		});

		expect(loadConfigStub).toHaveBeenCalledOnce();
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
			readFile: readIcon,
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

		vi.stubEnv("BEDROCK_API_KEY", "rbx-stub");
		try {
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
				readFile: readIcon,
				statePort: port,
			});

			expect(result.success).toBeTrue();
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("should not invoke getEnv when statePort, registry, config, and progress are all supplied", async () => {
		expect.assertions(1);

		const getEnvironment = vi.fn<(name: string) => string | undefined>();

		await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: getEnvironment,
			progress: { emit() {} },
			readFile: readIcon,
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
			readFile: readIcon,
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
				readFile: readIcon,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			expect(calls).toContainEqual({ environment: "production", kind: "stateWritten" });
		});

		it("should not emit stateWritten when statePort.write returns Err", async () => {
			expect.assertions(2);

			const writeFailure: StatePort = {
				async read() {
					return { data: undefined, success: true };
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
				readFile: readIcon,
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
				readFile: readIcon,
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
				readFile: readIcon,
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
						loadConfig: failingLoadConfig,
						readFile: readIcon,
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
						readFile: readIcon,
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
						readFile: readIcon,
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
						readFile: readIcon,
						registry: stubRegistryWithVipCreate(),
						statePort: {
							async read() {
								return { data: undefined, success: true };
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

				assert(failures[0]?.kind === "deployFailure");

				expect(
					matchError(failures[0].error) && failures[0].error === result.err,
				).toBeTrue();
			},
		);

		it("should pass the environment name verbatim through the deployFailure event", async () => {
			expect.assertions(1);

			const { calls, port: progress } = recordingProgress();

			await deploy({
				config: vipPassConfig(),
				environment: "ghost",
				progress,
				readFile: readIcon,
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
			const getEnvironment = vi.fn<(name: string) => string | undefined>((name) => {
				return name === "BEDROCK_API_KEY" ? "rbx-test" : undefined;
			});

			await deploy({
				config: vipPassConfig(),
				environment: "production",
				getEnv: getEnvironment,
				progress,
				readFile: readIcon,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			expect(calls.some((event) => event.kind === "deploySuccess")).toBeTrue();
			expect(getEnvironment.mock.calls.some(([name]) => name === "BEDROCK_CLI")).toBeFalse();
		});

		it("should consult getEnv with 'BEDROCK_CLI' when progress is omitted", async () => {
			expect.assertions(1);

			const { port: statePort } = inMemoryStatePort();
			const getEnvironment = vi.fn<(name: string) => string | undefined>((name) => {
				return name === "BEDROCK_API_KEY" ? "rbx-test" : undefined;
			});

			await deploy({
				config: vipPassConfig(),
				environment: "production",
				getEnv: getEnvironment,
				readFile: readIcon,
				registry: stubRegistryWithVipCreate(),
				statePort,
			});

			expect(getEnvironment.mock.calls.some(([name]) => name === "BEDROCK_CLI")).toBeTrue();
		});

		it("should default to the clack adapter when progress is omitted and BEDROCK_CLI is set", async () => {
			expect.assertions(1);

			const chunks: Array<string> = [];
			const writeSpy = vi
				.spyOn(process.stdout, "write")
				.mockImplementation((chunk: string | Uint8Array): boolean => {
					chunks.push(
						typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
					);
					return true;
				});

			try {
				const { port: statePort } = inMemoryStatePort();

				await deploy({
					config: vipPassConfig(),
					environment: "production",
					getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test", BEDROCK_CLI: "1" }),
					readFile: readIcon,
					registry: stubRegistryWithVipCreate(),
					statePort,
				});
			} finally {
				writeSpy.mockRestore();
			}

			expect(chunks.join("")).toContain("production: 1 resources reconciled");
		});

		it("should render stateWritten with the loaded backend label when options.config is omitted but loadConfig succeeds and BEDROCK_CLI is set", async () => {
			expect.assertions(1);

			const chunks: Array<string> = [];
			const writeSpy = vi
				.spyOn(process.stdout, "write")
				.mockImplementation((chunk: string | Uint8Array): boolean => {
					chunks.push(
						typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
					);
					return true;
				});

			try {
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
					readFile: readIcon,
					registry: stubRegistryWithVipCreate(),
					statePort,
				});
			} finally {
				writeSpy.mockRestore();
			}

			expect(chunks.join("")).toContain("State written to gist:abc-test");
		});

		it("should surface resolveDeps failure through the default clack path when BEDROCK_CLI is set", async () => {
			expect.assertions(1);

			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			try {
				const result = await deploy({
					config: vipPassConfig(),
					environment: "ghost",
					getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test", BEDROCK_CLI: "1" }),
					readFile: readIcon,
					registry: stubRegistry(),
					statePort: inMemoryStatePort().port,
				});

				assert(!result.success);

				expect(result.err.kind).toBe("unknownEnvironment");
			} finally {
				writeSpy.mockRestore();
			}
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
					readFile: readIcon,
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
					readFile: readIcon,
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
				readFile: readIcon,
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
				readFile: readIcon,
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
				readFile: readIcon,
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
				readFile: readIcon,
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
				readFile: readIcon,
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
				.mockImplementation(async (desired) => {
					if (desired.key === "alpha-pass") {
						return { data: alphaCurrent, success: true };
					}

					return { err: cause, success: false };
				});
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
				readFile: readIcon,
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
				readFile: readIcon,
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
				readFile: readIcon,
				registry: stubRegistryWithVipCreate(),
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(emit).toHaveBeenCalledOnce();
		});

		it("should default to a node-fs writer rooted at the configured output when none is injected", async () => {
			expect.assertions(1);

			const emit = vi.fn<Emitter>().mockResolvedValue([]);
			const result = await deploy({
				config: codegenVipConfig("src/generated"),
				emit,
				environment: "production",
				readFile: readIcon,
				registry: stubRegistryWithVipCreate(),
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(emit).toHaveBeenCalledOnce();
		});
	});

	describe("two-phase deploy", () => {
		const rebuiltBytes = new Uint8Array([10, 20, 30]);
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

		function twoPhaseConfig(): Config {
			return {
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				passes: { "vip-pass": VipPassEntry },
				places: { "start-place": { filePath: "places/start.rbxl" } },
			};
		}

		function cannedRebuild(): ReadonlyArray<RebuiltPlace> {
			return [{ key: startPlace, bytes: rebuiltBytes }];
		}

		function twoPhaseEmit(): ReadonlyArray<CodegenFile> {
			return [CODEGEN_FILE];
		}

		function withCodegen(config: Config): Config {
			return { ...config, codegen: { enabled: true, output: "src/generated" } };
		}

		function twoPhaseCodegenConfig(): Config {
			return withCodegen(twoPhaseConfig());
		}

		it("should publish the rebuild hook's bytes to the place driver instead of the pre-built file", async () => {
			expect.assertions(1);

			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: cannedRebuild,
				registry,
				statePort: inMemoryStatePort().port,
			});

			assert(result.success);

			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: rebuiltBytes, type: "create" },
			]);
		});

		it("should give the rebuild hook the freshly minted asset IDs", async () => {
			expect.assertions(1);

			let received: BedrockState | undefined;
			const { registry } = recordingPlaceRegistry();

			await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: ({ state }) => {
					received = state;
					return [{ key: startPlace, bytes: rebuiltBytes }];
				},
				registry,
				statePort: inMemoryStatePort().port,
			});

			expect(received?.resources).toContainEqual(vipPassCurrent());
		});

		it("should set the pending-rebuild marker at the checkpoint write and clear it at the final write", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort();
			const { registry } = recordingPlaceRegistry();

			await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: cannedRebuild,
				registry,
				statePort: port,
			});

			expect(writes).toHaveLength(2);
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
			expect(writes[1]!.pendingRebuild).toBeUndefined();
		});

		it("should republish each place from its keyed entry for a multi-place universe", async () => {
			expect.assertions(2);

			const lobbyBytes = new Uint8Array([1, 1]);
			const arenaBytes = new Uint8Array([2, 2]);
			const { placeCalls, registry } = recordingPlaceRegistry();

			await deploy({
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
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: () => {
					return [
						{ key: asResourceKey("lobby"), bytes: lobbyBytes },
						{ key: asResourceKey("arena"), bytes: arenaBytes },
					];
				},
				registry,
				statePort: inMemoryStatePort().port,
			});

			expect(placeCalls).toContainEqual({
				key: asResourceKey("lobby"),
				artifact: lobbyBytes,
				type: "create",
			});
			expect(placeCalls).toContainEqual({
				key: asResourceKey("arena"),
				artifact: arenaBytes,
				type: "create",
			});
		});

		it("should republish a place already in state with the hook's bytes via an update", async () => {
			expect.assertions(1);

			const priorPlace: ResourceCurrentState<"place"> = {
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
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: cannedRebuild,
				registry,
				statePort: inMemoryStatePort({
					environment: "production",
					resources: [priorPlace],
					version: 1,
				}).port,
			});

			assert(result.success);

			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: rebuiltBytes, type: "update" },
			]);
		});

		it("should publish places normally in a single pass when no rebuild hook is supplied", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				config: twoPhaseConfig(),
				environment: "production",
				readFile: readIcon,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(writes).toHaveLength(1);
			expect(writes[0]!.pendingRebuild).toBeUndefined();
			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: undefined, type: "create" },
			]);
		});

		it("should abort the rebuild and surface applyFailed when the asset stage apply fails", async () => {
			expect.assertions(3);

			const { placeCalls, registry } = recordingPlaceRegistry();
			let didCallHook = false;
			const failingRegistry: DriverRegistry = {
				...registry,
				gamePass: {
					async create() {
						return { err: new OpenCloudError("create vip-pass: 503"), success: false };
					},
				},
			};

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: () => {
					didCallHook = true;
					return [{ key: startPlace, bytes: rebuiltBytes }];
				},
				registry: failingRegistry,
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("applyFailed");
			expect(didCallHook).toBeFalse();
			expect(placeCalls).toBeEmpty();
		});

		it("should abort the rebuild and surface stateWriteFailed when the checkpoint write fails", async () => {
			expect.assertions(3);

			const { placeCalls, registry } = recordingPlaceRegistry();
			let didCallHook = false;
			const port: StatePort = {
				async read() {
					return { data: undefined, success: true };
				},
				async write() {
					return {
						err: { file: "state.json", kind: "stateError", reason: "EACCES" },
						success: false,
					};
				},
			};

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: () => {
					didCallHook = true;
					return [{ key: startPlace, bytes: rebuiltBytes }];
				},
				registry,
				statePort: port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("stateWriteFailed");
			expect(didCallHook).toBeFalse();
			expect(placeCalls).toBeEmpty();
		});

		it("should keep the pending-rebuild marker for a place the hook did not republish", async () => {
			expect.assertions(2);

			const { port, writes } = inMemoryStatePort();
			const { registry } = recordingPlaceRegistry();

			await deploy({
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
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: () => [{ key: asResourceKey("lobby"), bytes: rebuiltBytes }],
				registry,
				statePort: port,
			});

			expect(writes[0]!.pendingRebuild).toStrictEqual(
				new Set([asResourceKey("arena"), asResourceKey("lobby")]),
			);
			expect(writes[1]!.pendingRebuild).toStrictEqual(new Set([asResourceKey("arena")]));
		});

		it("should publish in a single pass when codegen is not enabled even with a rebuild hook", async () => {
			expect.assertions(4);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();
			let didCallHook = false;

			const result = await deploy({
				config: {
					environments: {
						production: { places: { "start-place": { placeId: "4711" } } },
					},
					places: { "start-place": { filePath: "places/start.rbxl" } },
				},
				environment: "production",
				readFile: readIcon,
				rebuild: () => {
					didCallHook = true;
					return [{ key: startPlace, bytes: rebuiltBytes }];
				},
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(didCallHook).toBeFalse();
			expect(writes).toHaveLength(1);
			expect(writes[0]!.pendingRebuild).toBeUndefined();
			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: undefined, type: "create" },
			]);
		});

		it("should run codegen with the minted IDs during a two-phase deploy", async () => {
			expect.assertions(2);

			const inputs: Array<EmitInput> = [];
			const writer = inMemoryCodegenWriter();
			const { registry } = recordingPlaceRegistry();

			await deploy({
				codegenWriter: writer.port,
				config: {
					...twoPhaseConfig(),
					codegen: { enabled: true, output: "src/generated" },
				},
				emit: async (input) => {
					inputs.push(input);
					return [CODEGEN_FILE];
				},
				environment: "production",
				readFile: readIcon,
				rebuild: cannedRebuild,
				registry,
				statePort: inMemoryStatePort().port,
			});

			expect(inputs[0]!.environments["production"]!.resources).toContainEqual(
				vipPassCurrent(),
			);
			expect(writer.writes).toStrictEqual([CODEGEN_FILE]);
		});

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

		function twoPassPlaceConfig(): Config {
			return {
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
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
			};
		}

		function partialFailureRegistry(): {
			placeCalls: Array<PlaceCall>;
			registry: DriverRegistry;
		} {
			const { placeCalls, registry } = recordingPlaceRegistry();
			return {
				placeCalls,
				registry: {
					...registry,
					gamePass: {
						async create(desired) {
							if (desired.key === asResourceKey("alpha-pass")) {
								return {
									err: new OpenCloudError("create alpha-pass: 503"),
									success: false,
								};
							}

							return { data: vipPassCurrent(), success: true };
						},
					},
				},
			};
		}

		it("should persist the asset outputs and marker and return rebuildHookThrew when the hook throws", async () => {
			expect.assertions(5);

			const { port, writes } = inMemoryStatePort();
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: () => {
					throw new Error("build blew up");
				},
				registry,
				statePort: port,
			});

			assert(!result.success);
			assert(result.err.kind === "rebuildHookThrew");

			expect(result.err.reason).toBe("build blew up");
			expect(writes).toHaveLength(1);
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
			expect(writes[0]!.resources).toContainEqual(vipPassCurrent());
			expect(placeCalls).toBeEmpty();
		});

		it("should stringify a non-Error thrown by the rebuild hook into the failure reason", async () => {
			expect.assertions(1);

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: vi.fn<RebuildHook>().mockRejectedValue("kaboom"),
				registry: recordingPlaceRegistry().registry,
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);
			assert(result.err.kind === "rebuildHookThrew");

			expect(result.err.reason).toBe("kaboom");
		});

		it("should emit codegen for resolved keys only on a partial asset failure", async () => {
			expect.assertions(3);

			const inputs: Array<EmitInput> = [];
			const writer = inMemoryCodegenWriter();
			const { registry } = partialFailureRegistry();

			const result = await deploy({
				codegenWriter: writer.port,
				config: {
					...twoPassPlaceConfig(),
					codegen: { enabled: true, output: "src/generated" },
				},
				emit: async (input) => {
					inputs.push(input);
					return [CODEGEN_FILE];
				},
				environment: "production",
				readFile: readIcon,
				rebuild: cannedRebuild,
				registry,
				statePort: inMemoryStatePort().port,
			});

			assert(!result.success);

			expect(result.err.kind).toBe("applyFailed");
			expect(inputs[0]!.environments["production"]!.resources).toContainEqual(
				vipPassCurrent(),
			);
			expect(inputs[0]!.environments["production"]!.resources).not.toContainEqual(
				alphaPassCurrent(),
			);
		});

		it("should re-activate two-phase from a marker and republish the marked place over a noop diff", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort(markedPriorState());
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				config: twoPhaseConfig(),
				environment: "production",
				readFile: readIcon,
				rebuild: cannedRebuild,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: rebuiltBytes, type: "update" },
			]);
			expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
			expect(writes[1]!.pendingRebuild).toBeUndefined();
		});

		it("should return pendingRebuildWithoutHook when a marker is present and no hook is available", async () => {
			expect.assertions(2);

			const { port, writes } = inMemoryStatePort(markedPriorState());

			const result = await deploy({
				config: twoPhaseConfig(),
				environment: "production",
				readFile: readIcon,
				registry: recordingPlaceRegistry().registry,
				statePort: port,
			});

			assert(!result.success);
			assert(result.err.kind === "pendingRebuildWithoutHook");

			expect(result.err.keys).toStrictEqual([startPlace]);
			expect(writes).toBeEmpty();
		});

		it("should clear a stuck marker without rebuilding when clearPendingRebuild is set", async () => {
			expect.assertions(2);

			const { port, writes } = inMemoryStatePort(markedPriorState());
			const { placeCalls, registry } = recordingPlaceRegistry();

			const result = await deploy({
				clearPendingRebuild: true,
				config: twoPhaseConfig(),
				environment: "production",
				readFile: readIcon,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(writes.at(-1)!.pendingRebuild).toBeUndefined();
			expect(placeCalls).toBeEmpty();
		});

		it("should not re-activate two-phase from a marker when clearPendingRebuild is set even with a hook", async () => {
			expect.assertions(3);

			const { port, writes } = inMemoryStatePort(markedPriorState());
			const { placeCalls, registry } = recordingPlaceRegistry();
			let didCallHook = false;

			const result = await deploy({
				clearPendingRebuild: true,
				config: twoPhaseConfig(),
				environment: "production",
				readFile: readIcon,
				rebuild: () => {
					didCallHook = true;
					return cannedRebuild();
				},
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(didCallHook).toBeFalse();
			expect(writes.at(-1)!.pendingRebuild).toBeUndefined();
			expect(placeCalls).toBeEmpty();
		});

		function priceEmit({ environments }: EmitInput): ReadonlyArray<CodegenFile> {
			const pass = environments["production"]?.resources.find(
				(resource) => resource.kind === "gamePass",
			);
			const price = pass !== undefined && "price" in pass ? pass.price : 0;
			return [{ content: `return { price = ${String(price)} }\n`, path: "ids.luau" }];
		}

		function priceUpdateRegistry(updatedPass: ResourceCurrentState<"gamePass">): {
			placeCalls: Array<PlaceCall>;
			registry: DriverRegistry;
		} {
			const { placeCalls, registry } = recordingPlaceRegistry();
			return {
				placeCalls,
				registry: {
					...registry,
					gamePass: {
						async create() {
							return { data: updatedPass, success: true };
						},
						async update() {
							return { data: updatedPass, success: true };
						},
					},
				},
			};
		}

		function priceUpdateConfig(price: number): Config {
			return withCodegen({
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				passes: { "vip-pass": { ...VipPassEntry, price } },
				places: { "start-place": { filePath: "places/start.rbxl" } },
			});
		}

		it("should rebuild and republish on a price-only update whose codegen output changed", async () => {
			expect.assertions(3);

			const storedHash = await hashCodegenFiles([
				{ content: "return { price = 500 }\n", path: "ids.luau" },
			]);
			const updatedPass = { ...vipPassCurrent(), price: 600 };
			const { placeCalls, registry } = priceUpdateRegistry(updatedPass);
			const { port, writes } = inMemoryStatePort({
				codegenHash: storedHash,
				environment: "production",
				resources: [vipPassCurrent(), startPlaceInState()],
				version: 1,
			});

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: priceUpdateConfig(600),
				emit: priceEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: cannedRebuild,
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: rebuiltBytes, type: "update" },
			]);
			expect(writes.at(-1)!.codegenHash).toBe(
				await hashCodegenFiles([{ content: "return { price = 600 }\n", path: "ids.luau" }]),
			);
			expect(writes.at(-1)!.pendingRebuild).toBeUndefined();
		});

		it("should publish the pre-built file without rebuilding when codegen output is unchanged", async () => {
			expect.assertions(3);

			const storedHash = await hashCodegenFiles([CODEGEN_FILE]);
			const priorPlace: ResourceCurrentState<"place"> = {
				...startPlaceInState(),
				fileHash: asSha256Hex(
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				),
			};
			const { placeCalls, registry } = recordingPlaceRegistry();
			let didCallHook = false;
			const { port, writes } = inMemoryStatePort({
				codegenHash: storedHash,
				environment: "production",
				resources: [vipPassCurrent(), priorPlace],
				version: 1,
			});

			const result = await deploy({
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: () => {
					didCallHook = true;
					return cannedRebuild();
				},
				registry,
				statePort: port,
			});

			assert(result.success);

			expect(didCallHook).toBeFalse();
			expect(placeCalls).toStrictEqual([
				{ key: startPlace, artifact: undefined, type: "update" },
			]);
			expect(writes.at(-1)!.codegenHash).toBe(storedHash);
		});

		it("should retain the stored hash and the marker when the rebuild hook throws", async () => {
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
				codegenWriter: inMemoryCodegenWriter().port,
				config: twoPhaseCodegenConfig(),
				emit: twoPhaseEmit,
				environment: "production",
				readFile: readIcon,
				rebuild: () => {
					throw new Error("build blew up");
				},
				registry: recordingPlaceRegistry().registry,
				statePort: port,
			});

			assert(!result.success);
			assert(result.err.kind === "rebuildHookThrew");

			expect(writes).toHaveLength(1);
			expect(writes[0]!.codegenHash).toBe(storedHash);
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
