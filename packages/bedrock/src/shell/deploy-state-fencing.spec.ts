import { assert, describe, expect, it } from "vitest";

import { environmentFrom } from "#tests/helpers/environment";
import type { CodegenFile } from "../core/codegen.ts";
import type { ResourceCurrentState, ResourceKind } from "../core/resources.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState, StateRecord, StateVersion } from "../core/state.ts";
import type { CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { deploy } from "./deploy.ts";

const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

const SILENT_PROGRESS: ProgressPort = { emit: () => {} };

const VIP_PASS_KEY = asResourceKey("vip-pass");

// The snapshot a record that exists holds, which a present version names.
const EMPTY_STATE: BedrockState = { environment: "production", resources: [], version: 1 };

async function readIconAsync(): Promise<Uint8Array> {
	return new Uint8Array();
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
		key: VIP_PASS_KEY,
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

function neverDriver<K extends ResourceKind>(): ResourceDriver<K> {
	return {
		async create() {
			throw new Error("driver must not run for this fixture");
		},
	};
}

function creatingRegistry(): DriverRegistry {
	return {
		developerProduct: neverDriver(),
		gamePass: {
			async create() {
				return { data: vipPassCurrent(), success: true };
			},
		},
		place: neverDriver(),
		universe: neverDriver(),
	};
}

/**
 * Build a state port that reports the given record on every read and
 * records the version each write was fenced against.
 *
 * @param record - What the read reports, carrying no version for a
 *   backend that cannot fence.
 * @returns The port and the versions its writes carried.
 */
function fencingStatePort(record: StateRecord): {
	fenced: Array<StateVersion | undefined>;
	port: StatePort;
} {
	const fenced: Array<StateVersion | undefined> = [];
	return {
		fenced,
		port: {
			async read() {
				return { data: record, success: true };
			},
			async write(_state, expected) {
				fenced.push(expected);
				return { data: undefined, success: true };
			},
		},
	};
}

describe("deploy against a fencing backend", () => {
	it.for<[string, StateRecord]>([
		[
			"a record it read",
			{ state: EMPTY_STATE, version: { kind: "present", token: '"9f3c1a"' } },
		],
		["the absence it read", { version: { kind: "absent" } }],
		["nothing, against a backend that reports no version", {}],
	])("should fence the state write against %s", async ([, record]) => {
		expect.assertions(1);

		const { fenced, port } = fencingStatePort(record);

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: creatingRegistry(),
			statePort: port,
		});

		assert(result.success);

		expect(fenced).toStrictEqual([record.version]);
	});

	it("should surface the applied-but-unrecorded resources when the write conflicts", async () => {
		expect.assertions(3);

		const port: StatePort = {
			async read() {
				return { data: { version: { kind: "absent" } }, success: true };
			},
			async write() {
				return {
					err: {
						file: "s3://my-bucket/production.json",
						kind: "stateConflict",
						reason: "the record moved since it was read",
					},
					success: false,
				};
			},
		};

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: creatingRegistry(),
			statePort: port,
		});

		assert(!result.success);
		assert(result.err.kind === "stateWriteFailed");

		expect(result.err.cause.kind).toBe("stateConflict");
		expect(result.err.unrecorded).toStrictEqual([vipPassCurrent()]);
		expect(result.err.unsavedState.resources).toStrictEqual([vipPassCurrent()]);
	});
});

/**
 * Build a state port that versions each stored record, so a later stage
 * reads a token the earlier stage's write produced.
 *
 * @returns The port and the versions its writes were fenced against.
 */
function versioningStatePort(): {
	fenced: Array<StateVersion | undefined>;
	port: StatePort;
} {
	const fenced: Array<StateVersion | undefined> = [];
	let stored: BedrockState | undefined;
	let revision = 0;

	return {
		fenced,
		port: {
			async read() {
				return stored === undefined
					? { data: { version: { kind: "absent" } }, success: true }
					: {
							data: {
								state: stored,
								version: { kind: "present", token: `v${revision}` },
							},
							success: true,
						};
			},
			async write(state, expected) {
				fenced.push(expected);
				stored = state;
				revision += 1;
				return { data: undefined, success: true };
			},
		},
	};
}

function fusedCodegenConfig(): Config {
	return {
		codegen: { enabled: true, output: "src/generated" },
		environments: { production: { places: { "start-place": { placeId: "4711" } } } },
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				price: 500,
			},
		},
		places: { "start-place": { filePath: "places/start.rbxl" } },
	};
}

function fusedRegistry(): DriverRegistry {
	const startPlace: ResourceCurrentState<"place"> = {
		key: asResourceKey("start-place"),
		description: undefined,
		displayName: undefined,
		fileHash: ICON_HASH,
		filePath: "places/start.rbxl",
		kind: "place",
		outputs: { versionNumber: 1 },
		placeId: asRobloxAssetId("4711"),
		serverSize: undefined,
	};

	return {
		developerProduct: neverDriver(),
		gamePass: {
			async create() {
				return { data: vipPassCurrent(), success: true };
			},
		},
		place: {
			async create() {
				return { data: startPlace, success: true };
			},
		},
		universe: neverDriver(),
	};
}

function discardingCodegenWriter(): CodegenWriterPort {
	return {
		async write() {
			return { data: undefined, success: true };
		},
	};
}

function emitNothing(): ReadonlyArray<CodegenFile> {
	return [{ content: "return {}\n", path: "ids.luau" }];
}

describe("deploy across a provision and a publish stage", () => {
	it("should fence each stage on the version its own read observed", async () => {
		expect.assertions(1);

		const { fenced, port } = versioningStatePort();

		const result = await deploy({
			build: async () => {},
			codegenWriter: discardingCodegenWriter(),
			config: fusedCodegenConfig(),
			emit: emitNothing,
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: fusedRegistry(),
			statePort: port,
		});

		assert(result.success);

		expect(fenced).toStrictEqual([{ kind: "absent" }, { kind: "present", token: "v1" }]);
	});
});
