import { describe, expect, it, vi } from "vitest";

import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { deploy } from "./deploy.ts";

const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
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
