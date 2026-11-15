import {
	asRobloxAssetId,
	type BedrockState,
	deploy,
	type DriverRegistry,
	type ResourceDriver,
	type StatePort,
} from "@bedrock-rbx/core";

import { assert, describe, it } from "vitest";

import { BADGE_TRAP } from "#tests/helpers/drivers";

const FILTERED = "##############";
const CONFIG = {
	environments: { production: {} },
	products: {
		"coin-pack": { name: "Coin Pack", description: "Coins." },
		"gem-pack": { name: "Gem Pack 12345", description: "Gems." },
	},
} as const;
const PRODUCT_IDS: Record<string, string> = { "coin-pack": "2", "gem-pack": "1" };

function storedName(desired: { readonly key: string; readonly name: string }): string {
	return desired.key === "gem-pack" ? FILTERED : desired.name;
}

const filteringProducts: ResourceDriver<"developerProduct"> = {
	async create(desired) {
		return {
			data: {
				...desired,
				name: storedName(desired),
				outputs: { productId: asRobloxAssetId(PRODUCT_IDS[desired.key]!) },
			},
			success: true,
		};
	},
	async retire() {
		throw new Error("Unexpected retire");
	},
	async update(current, desired) {
		return {
			data: { ...desired, name: storedName(desired), outputs: current.outputs },
			success: true,
		};
	},
};

function registry(): DriverRegistry {
	const trap = {
		async create(): Promise<never> {
			throw new Error("Unexpected create");
		},
		async retire(): Promise<never> {
			throw new Error("Unexpected retire");
		},
	};
	return {
		badge: BADGE_TRAP,
		developerProduct: filteringProducts,
		gamePass: trap,
		place: trap,
		universe: trap,
	};
}

function stateHarness(): { port: StatePort; writes: Array<BedrockState> } {
	let state: BedrockState = { environment: "production", resources: [], version: 1 };
	const writes: Array<BedrockState> = [];
	return {
		port: {
			async read() {
				return {
					data: { state, version: { kind: "present", token: "1" } },
					success: true,
				};
			},
			async write(next) {
				state = next;
				writes.push(next);
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

async function deployOnce(port: StatePort) {
	return deploy({
		config: CONFIG,
		environment: "production",
		live: false,
		readFile: async () => {
			throw new Error("No icons in this fixture");
		},
		registry: registry(),
		statePort: port,
	});
}

const MODERATED = {
	key: "gem-pack",
	kind: "moderatedName",
	stored: FILTERED,
	submitted: "Gem Pack 12345",
};

describe("moderated developer product name", () => {
	it("should persist the stored name and fail the deploy with moderatedName", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { port, writes } = stateHarness();
		const result = await deployOnce(port);

		assert(!result.success);

		expect(result.err).toMatchObject({
			cause: { failures: [MODERATED] },
			kind: "applyFailed",
		});
		expect(writes.at(-1)!.resources).toMatchObject([
			{ key: "coin-pack", name: "Coin Pack", outputs: { productId: "2" } },
			{ key: "gem-pack", name: FILTERED, outputs: { productId: "1" } },
		]);
	});

	it("should fail again with moderatedName on a second deploy with the same config", async ({
		expect,
	}) => {
		expect.assertions(2);

		const { port, writes } = stateHarness();
		await deployOnce(port);
		const second = await deployOnce(port);

		expect(second).toMatchObject({
			err: { cause: { failures: [MODERATED] }, kind: "applyFailed" },
			success: false,
		});
		expect(writes.at(-1)!.resources).toMatchObject([
			{ key: "coin-pack", name: "Coin Pack" },
			{ key: "gem-pack", name: FILTERED, outputs: { productId: "1" } },
		]);
	});
});
