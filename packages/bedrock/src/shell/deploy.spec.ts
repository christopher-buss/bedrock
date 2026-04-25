import { OpenCloudError } from "@bedrock/ocale";

import { assert, describe, expect, it, vi } from "vitest";

import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { deploy } from "./deploy.ts";

// Empty bytes hash to SHA-256 `e3b0c44...`; keeping readIcon in lockstep with
// the hash constant lets the noop test assert "desired matches current" without
// recomputing digests at runtime.
const ICON_BYTES = new Uint8Array();
const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

async function readIcon(): Promise<Uint8Array> {
	return ICON_BYTES;
}

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
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				iconFilePath: "assets/vip-icon.png",
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
		iconFileHash: ICON_HASH,
		iconFilePath: "assets/vip-icon.png",
		kind: "gamePass" as const,
		outputs: {
			assetId: asRobloxAssetId("9876543210"),
			iconAssetId: asRobloxAssetId("1122334455"),
		},
		price: 500,
	};
}

function twoPassConfig(): Config {
	// Keys ordered for deterministic dispatch: lint sorts collection keys
	// alphabetically, so alpha-pass runs first and vip-pass second. Tests
	// rely on that order when asserting which dispatch failed.
	return {
		passes: {
			"alpha-pass": {
				name: "Alpha Pass",
				description: "Grants alpha perks.",
				iconFilePath: "assets/alpha-icon.png",
				price: 250,
			},
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				iconFilePath: "assets/vip-icon.png",
				price: 500,
			},
		},
	};
}

function configWithState(): Config {
	return {
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				iconFilePath: "assets/vip-icon.png",
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
		gamePass: {
			async create() {
				return { data: vipPassCurrent(), success: true };
			},
		},
		place: placeStub,
		universe: universeStub,
	};
}

function alphaPassCurrent() {
	return {
		key: asResourceKey("alpha-pass"),
		name: "Alpha Pass",
		description: "Grants alpha perks.",
		iconFileHash: ICON_HASH,
		iconFilePath: "assets/alpha-icon.png",
		kind: "gamePass" as const,
		outputs: {
			assetId: asRobloxAssetId("1111111111"),
			iconAssetId: asRobloxAssetId("2222222222"),
		},
		price: 250,
	};
}

describe(deploy, () => {
	it("should reconcile a first deploy by creating the desired resource and persisting the new state", async () => {
		expect.assertions(5);

		const created = vipPassCurrent();
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockResolvedValue({ data: created, success: true });
		const registry: DriverRegistry = {
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
			passes: {
				"vip-pass": {
					name: "VIP Pass",
					description: "Grants VIP perks.",
					iconFilePath: "assets/vip-icon.png",
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
					key: asResourceKey("vip-pass"),
					appliedSoFar: [alphaCurrent],
					cause,
					kind: "driverFailure",
				},
				kind: "applyFailed",
			},
			success: false,
		});
	});

	it("should surface stateReadFailed without dispatching drivers or writing state when StatePort.read returns Err", async () => {
		expect.assertions(3);

		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const registry: DriverRegistry = {
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

	it("should surface applyFailed and still attempt to persist the partial snapshot even when the write then rejects", async () => {
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
				cause: {
					key: asResourceKey("vip-pass"),
					appliedSoFar: [alphaCurrent],
					cause,
					kind: "driverFailure",
				},
				kind: "applyFailed",
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
		const registry: DriverRegistry = {
			gamePass: { create },
			place: placeStub,
			universe: universeStub,
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
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_test" }),
			readFile: readIcon,
			registry,
		});

		assert(result.success);

		expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
		expect(result.data.environment).toBe("production");
	});

	it("should return Err(stateNotConfigured) when statePort is omitted and the config has no state for the environment", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: { passes: {} },
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
			config: { state: { backend: "s3" } },
			environment: "production",
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_test" }),
			readFile: readIcon,
			registry: stubRegistry(),
		});

		assert(!result.success);
		assert(result.err.kind === "unsupportedBackend");

		expect(result.err.kind).toBe("unsupportedBackend");
		expect(result.err.backend).toBe("s3");
	});

	it("should return Err(missingCredential) when GITHUB_TOKEN is unset on the default-construction state-port path", async () => {
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

		expect(result.err.variable).toBe("GITHUB_TOKEN");
		expect(result.err.purpose).toBe("stateBackend");
	});

	it("should default-construct the registry from ROBLOX_API_KEY when registry is omitted", async () => {
		expect.assertions(1);

		const { port } = inMemoryStatePort();

		const result = await deploy({
			config: { state: { backend: "gist", gistId: "abc" }, universe: { universeId: "1" } },
			environment: "production",
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_test", ROBLOX_API_KEY: "rbx-test" }),
			readFile: readIcon,
			statePort: port,
		});

		assert(result.success);

		expect(result.data.environment).toBe("production");
	});

	it("should return Err(missingCredential) when ROBLOX_API_KEY is unset on the default-construction registry path", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: { state: { backend: "gist", gistId: "abc" }, universe: { universeId: "1" } },
			environment: "production",
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_test" }),
			readFile: readIcon,
			statePort: inMemoryStatePort().port,
		});

		assert(!result.success);
		assert(result.err.kind === "missingCredential");

		expect(result.err.variable).toBe("ROBLOX_API_KEY");
		expect(result.err.purpose).toBe("registry");
	});

	it("should return Err(registryConfigMissing) when registry is omitted and config.universe is absent", async () => {
		expect.assertions(2);

		const result = await deploy({
			config: { state: { backend: "gist", gistId: "abc" } },
			environment: "production",
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_test", ROBLOX_API_KEY: "rbx-test" }),
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

		const minimalConfig: Config = { state: { backend: "gist", gistId: "abc-test" } };
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

		vi.stubEnv("ROBLOX_API_KEY", "rbx-stub");
		try {
			const result = await deploy({
				config: {
					state: { backend: "gist", gistId: "abc" },
					universe: { universeId: "1234567890" },
				},
				environment: "production",
				readFile: readIcon,
				statePort: inMemoryStatePort().port,
			});

			expect(result.success).toBeTrue();
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("should not invoke getEnv when statePort, registry, and config are all supplied", async () => {
		expect.assertions(1);

		const getEnvironment = vi.fn<(name: string) => string | undefined>();

		await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: getEnvironment,
			readFile: readIcon,
			registry: stubRegistryWithVipCreate(),
			statePort: inMemoryStatePort().port,
		});

		expect(getEnvironment).not.toHaveBeenCalled();
	});

	it("should surface buildDesiredFailed without dispatching drivers or writing state when readFile rejects", async () => {
		expect.assertions(3);

		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const registry: DriverRegistry = {
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
});
