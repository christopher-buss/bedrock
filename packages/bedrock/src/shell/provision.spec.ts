import { OpenCloudError } from "@bedrock-rbx/ocale";

import { assert, describe, expect, it, vi } from "vitest";

import { outcomeByKey } from "#tests/helpers/drivers";
import { fakeReadFile } from "#tests/helpers/files";
import { gamePassCurrent } from "#tests/helpers/resources";
import type { CodegenFile, EmitInput, Emitter } from "../core/codegen.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { provision } from "./deploy.ts";

const ICON_BYTES = new Uint8Array();

async function readIconAsync(): Promise<Uint8Array> {
	return ICON_BYTES;
}

const startPlace = asResourceKey("start-place");
const CODEGEN_FILE: CodegenFile = { content: "return {}\n", path: "ids.luau" };

const developerProductStub: ResourceDriver<"developerProduct"> = {
	async create() {
		throw new Error("developerProduct driver must not run for this fixture");
	},
};

const placeStub: ResourceDriver<"place"> = {
	async create() {
		throw new Error("place driver must not run: provision withholds place ops");
	},
	async update() {
		throw new Error("place driver must not run: provision withholds place ops");
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

const VipPassEntry = {
	name: "VIP Pass",
	description: "Grants VIP perks.",
	icon: { "en-us": "assets/vip-icon.png" },
	price: 500,
} as const;

const AlphaPassEntry = {
	name: "Alpha Pass",
	description: "Grants alpha perks.",
	icon: { "en-us": "assets/alpha-icon.png" },
	price: 250,
} as const;

function provisionConfig(): Config {
	return {
		environments: { production: { places: { "start-place": { placeId: "4711" } } } },
		passes: { "vip-pass": VipPassEntry },
		places: { "start-place": { filePath: "places/start.rbxl" } },
	};
}

function withCodegen(config: Config): Config {
	return { ...config, codegen: { enabled: true, output: "src/generated" } };
}

function vipCreateRegistry(): DriverRegistry {
	return {
		developerProduct: developerProductStub,
		gamePass: {
			async create() {
				return { data: gamePassCurrent(), success: true };
			},
		},
		place: placeStub,
		universe: universeStub,
	};
}

function alphaPassCurrent(): ResourceCurrentState<"gamePass"> {
	return gamePassCurrent({
		key: asResourceKey("alpha-pass"),
		name: "Alpha Pass",
		description: "Grants alpha perks.",
		icon: { "en-us": "assets/alpha-icon.png" },
		outputs: {
			assetId: asRobloxAssetId("1111111111"),
			iconAssetIds: { "en-us": asRobloxAssetId("2222222222") },
		},
		price: 250,
	});
}

describe(provision, () => {
	it("should mint non-place ops and mark every declared place pending without dispatching the place driver", async () => {
		expect.assertions(2);

		const { port, writes } = inMemoryStatePort();

		const result = await provision({
			config: provisionConfig(),
			environment: "production",
			readFile: readIconAsync,
			registry: vipCreateRegistry(),
			statePort: port,
		});

		assert(result.success);

		expect(writes[0]!.resources).toStrictEqual([gamePassCurrent()]);
		expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
	});

	it("should run the emitter and write codegen after the checkpoint", async () => {
		expect.assertions(1);

		const writer = inMemoryCodegenWriter();
		const emit = vi.fn<Emitter>().mockResolvedValue([CODEGEN_FILE]);

		const result = await provision({
			codegenWriter: writer.port,
			config: withCodegen(provisionConfig()),
			emit,
			environment: "production",
			readFile: readIconAsync,
			registry: vipCreateRegistry(),
			statePort: inMemoryStatePort().port,
		});

		assert(result.success);

		// The emitter's output reached the writer: proof codegen fired.
		expect(writer.writes).toStrictEqual([CODEGEN_FILE]);
	});

	it("should persist survivors and the marker and emit only resolved keys on a partial asset failure", async () => {
		expect.assertions(4);

		const alpha = alphaPassCurrent();
		const cause = new OpenCloudError("create vip-pass: 503");
		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementation(outcomeByKey({ "alpha-pass": alpha, "vip-pass": cause }));
		const inputs: Array<EmitInput> = [];
		const emit = vi.fn<Emitter>(async (input) => {
			inputs.push(input);
			return [CODEGEN_FILE];
		});
		const { port, writes } = inMemoryStatePort();

		const result = await provision({
			codegenWriter: inMemoryCodegenWriter().port,
			config: withCodegen({
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				passes: { "alpha-pass": AlphaPassEntry, "vip-pass": VipPassEntry },
				places: { "start-place": { filePath: "places/start.rbxl" } },
			}),
			emit,
			environment: "production",
			readFile: readIconAsync,
			registry: {
				developerProduct: developerProductStub,
				gamePass: { create },
				place: placeStub,
				universe: universeStub,
			},
			statePort: port,
		});

		assert(!result.success);

		expect(result.err.kind).toBe("applyFailed");
		expect(writes[0]!.resources).toStrictEqual([alpha]);
		expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
		expect(inputs[0]!.environments["production"]!.resources).toStrictEqual([alpha]);
	});

	it("should not read the place artifact file so it can run before the place is built", async () => {
		expect.assertions(2);

		const { port, writes } = inMemoryStatePort();
		const readFile = vi.fn<(path: string) => Promise<Uint8Array>>(
			fakeReadFile(
				{
					"places/start.rbxl": new Error(
						"place artifact must not be read during provision",
					),
				},
				ICON_BYTES,
			),
		);

		const result = await provision({
			config: provisionConfig(),
			environment: "production",
			readFile,
			registry: vipCreateRegistry(),
			statePort: port,
		});

		assert(result.success);

		expect(writes[0]!.pendingRebuild).toStrictEqual(new Set([startPlace]));
		expect(readFile).not.toHaveBeenCalledWith("places/start.rbxl");
	});

	it("should surface stateReadFailed without dispatching drivers when StatePort.read returns Err", async () => {
		expect.assertions(1);

		const stateError = {
			file: ".bedrock/state/production.json",
			kind: "stateError" as const,
			reason: "Corrupt JSON",
		};
		const port: StatePort = {
			async read() {
				return { err: stateError, success: false };
			},
			async write() {
				return { data: undefined, success: true };
			},
		};

		const result = await provision({
			config: provisionConfig(),
			environment: "production",
			readFile: readIconAsync,
			registry: vipCreateRegistry(),
			statePort: port,
		});

		expect(result).toStrictEqual({
			err: { cause: stateError, kind: "stateReadFailed" },
			success: false,
		});
	});
});
