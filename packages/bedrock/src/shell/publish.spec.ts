import { OpenCloudError } from "@bedrock-rbx/ocale";

import { assert, describe, expect, it, vi } from "vitest";

import { placeCurrent } from "#tests/helpers/resources";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asSha256Hex } from "../types/ids.ts";
import { publish } from "./deploy.ts";

// `readPlace` returns bytes [1,2,3], which hash to PLACE_HASH — the default
// `fileHash` on the place fixtures. A current place carrying PLACE_HASH is
// therefore a noop (unchanged artifact); one carrying STALE_HASH drifts.
const PLACE_BYTES = new Uint8Array([1, 2, 3]);
const STALE_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
const startPlace = asResourceKey("start-place");

async function readPlace(): Promise<Uint8Array> {
	return PLACE_BYTES;
}

const developerProductStub: ResourceDriver<"developerProduct"> = {
	async create() {
		throw new Error("developerProduct driver must not run for this fixture");
	},
};

const universeStub: ResourceDriver<"universe"> = {
	async create() {
		throw new Error("universe driver must not run for this fixture");
	},
};

const gamePassStub: ResourceDriver<"gamePass"> = {
	async create() {
		throw new Error("gamePass driver must not run for this fixture");
	},
};

interface PlaceCall {
	readonly key: string;
	readonly type: "create" | "update";
}

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

function recordingPlaceRegistry(placeDriver?: Partial<ResourceDriver<"place">>): {
	placeCalls: Array<PlaceCall>;
	registry: DriverRegistry;
} {
	const placeCalls: Array<PlaceCall> = [];
	const place: ResourceDriver<"place"> = {
		async create(desired) {
			placeCalls.push({ key: desired.key, type: "create" });
			return { data: placeCurrent(), success: true };
		},

		async update(_current, desired) {
			placeCalls.push({ key: desired.key, type: "update" });
			return { data: { ...placeCurrent(), outputs: { versionNumber: 2 } }, success: true };
		},
		...placeDriver,
	};
	return {
		placeCalls,
		registry: {
			developerProduct: developerProductStub,
			gamePass: gamePassStub,
			place,
			universe: universeStub,
		},
	};
}

function publishConfig(): Config {
	return {
		environments: { production: { places: { "start-place": { placeId: "4711" } } } },
		places: { "start-place": { filePath: "places/start.rbxl" } },
	};
}

function priorWith(
	place: ResourceCurrentState<"place">,
	pendingRebuild?: ReadonlySet<ReturnType<typeof asResourceKey>>,
): BedrockState {
	return {
		environment: "production",
		resources: [place],
		version: 1,
		...(pendingRebuild === undefined ? {} : { pendingRebuild }),
	};
}

describe(publish, () => {
	it("should republish a pending place whose artifact changed and clear its marker", async () => {
		expect.assertions(2);

		const { placeCalls, registry } = recordingPlaceRegistry();
		const { port, writes } = inMemoryStatePort(
			priorWith(placeCurrent({ fileHash: STALE_HASH }), new Set([startPlace])),
		);

		const result = await publish({
			config: publishConfig(),
			environment: "production",
			readFile: readPlace,
			registry,
			statePort: port,
		});

		assert(result.success);

		expect(placeCalls).toStrictEqual([{ key: "start-place", type: "update" }]);
		expect(writes.at(-1)!.pendingRebuild).toBeUndefined();
	});

	it("should not read asset icon files because it reconciles only places", async () => {
		expect.assertions(2);

		const { placeCalls, registry } = recordingPlaceRegistry();
		const { port } = inMemoryStatePort(
			priorWith(placeCurrent({ fileHash: STALE_HASH }), new Set([startPlace])),
		);
		const readFile = vi.fn<(path: string) => Promise<Uint8Array>>(async (path) => {
			if (path === "places/start.rbxl") {
				return PLACE_BYTES;
			}

			throw new Error(`publish must not read non-place file: ${path}`);
		});

		const result = await publish({
			config: {
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
			},
			environment: "production",
			readFile,
			registry,
			statePort: port,
		});

		assert(result.success);

		expect(placeCalls).toStrictEqual([{ key: "start-place", type: "update" }]);
		expect(readFile).not.toHaveBeenCalledWith("assets/vip-icon.png");
	});

	it("should keep the marker and skip the upload when a pending place's artifact is unchanged", async () => {
		expect.assertions(2);

		const { placeCalls, registry } = recordingPlaceRegistry();
		const { port, writes } = inMemoryStatePort(
			priorWith(placeCurrent(), new Set([startPlace])),
		);

		const result = await publish({
			config: publishConfig(),
			environment: "production",
			readFile: readPlace,
			registry,
			statePort: port,
		});

		assert(result.success);

		expect(placeCalls).toBeEmpty();
		expect(writes.at(-1)!.pendingRebuild).toStrictEqual(new Set([startPlace]));
	});

	it("should keep the marker when republishing a pending place fails", async () => {
		expect.assertions(2);

		const cause = new OpenCloudError("publish start-place: 503");
		const { registry } = recordingPlaceRegistry({
			async update() {
				return { err: cause, success: false };
			},
		});
		const { port, writes } = inMemoryStatePort(
			priorWith(placeCurrent({ fileHash: STALE_HASH }), new Set([startPlace])),
		);

		const result = await publish({
			config: publishConfig(),
			environment: "production",
			readFile: readPlace,
			registry,
			statePort: port,
		});

		assert(!result.success);

		expect(result.err.kind).toBe("applyFailed");
		expect(writes.at(-1)!.pendingRebuild).toStrictEqual(new Set([startPlace]));
	});

	it("should not mint a non-place resource that drifts in config", async () => {
		expect.assertions(2);

		const productCreate = vi.fn<ResourceDriver<"developerProduct">["create"]>();
		const { placeCalls, registry } = recordingPlaceRegistry();
		const { port } = inMemoryStatePort(
			priorWith(placeCurrent({ fileHash: STALE_HASH }), new Set([startPlace])),
		);

		const result = await publish({
			config: {
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				places: { "start-place": { filePath: "places/start.rbxl" } },
				products: { "gem-pack": { name: "Gem Pack", description: "1,000 gems." } },
			},
			environment: "production",
			readFile: readPlace,
			registry: { ...registry, developerProduct: { create: productCreate } },
			statePort: port,
		});

		assert(result.success);

		expect(productCreate).not.toHaveBeenCalled();
		expect(placeCalls).toStrictEqual([{ key: "start-place", type: "update" }]);
	});

	it("should be a no-op success that dispatches nothing when no place owes a rebuild", async () => {
		expect.assertions(3);

		const { placeCalls, registry } = recordingPlaceRegistry();
		const { port, writes } = inMemoryStatePort(
			priorWith(placeCurrent({ fileHash: STALE_HASH })),
		);

		const result = await publish({
			config: publishConfig(),
			environment: "production",
			readFile: readPlace,
			registry,
			statePort: port,
		});

		assert(result.success);

		expect(placeCalls).toBeEmpty();
		expect(writes.at(-1)!.pendingRebuild).toBeUndefined();
		expect(result.data.resources).toStrictEqual([placeCurrent({ fileHash: STALE_HASH })]);
	});

	it("should surface stateReadFailed without dispatching drivers when StatePort.read returns Err", async () => {
		expect.assertions(1);

		const stateError = {
			file: ".bedrock/state/production.json",
			kind: "stateError" as const,
			reason: "Corrupt JSON",
		};
		const { registry } = recordingPlaceRegistry();
		const port: StatePort = {
			async read() {
				return { err: stateError, success: false };
			},
			async write() {
				return { data: undefined, success: true };
			},
		};

		const result = await publish({
			config: publishConfig(),
			environment: "production",
			readFile: readPlace,
			registry,
			statePort: port,
		});

		expect(result).toStrictEqual({
			err: { cause: stateError, kind: "stateReadFailed" },
			success: false,
		});
	});
});
