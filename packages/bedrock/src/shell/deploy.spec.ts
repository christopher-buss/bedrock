import { OpenCloudError } from "@bedrock/ocale";

import { describe, expect, it, vi } from "vitest";

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
		const registry: DriverRegistry = { gamePass: { create }, place: placeStub };
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
		const registry: DriverRegistry = { gamePass: { create }, place: placeStub };
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
		const registry: DriverRegistry = { gamePass: { create }, place: placeStub };
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
		const registry: DriverRegistry = { gamePass: { create }, place: placeStub };
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
		const registry: DriverRegistry = { gamePass: { create }, place: placeStub };
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

	it("should surface buildDesiredFailed without dispatching drivers or writing state when readFile rejects", async () => {
		expect.assertions(3);

		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const registry: DriverRegistry = { gamePass: { create }, place: placeStub };
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
