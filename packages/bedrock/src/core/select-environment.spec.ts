import { assert, describe, expect, it } from "vitest";

import type {
	Config,
	DeveloperProductEntry,
	GamePassEntry,
	PlaceEntry,
	StateConfig,
} from "./schema.ts";
import { selectEnvironment } from "./select-environment.ts";

const ROOT_STATE: StateConfig = { backend: "gist", gistId: "root-gist" };
const PROD_STATE: StateConfig = { backend: "gist", gistId: "prod-gist" };

const VIP_PASS: GamePassEntry = {
	name: "VIP Pass",
	description: "Grants VIP perks.",
	iconFilePath: "assets/vip.png",
	price: 500,
};

const GEM_PACK: DeveloperProductEntry = {
	name: "Gem Pack",
	description: "Stocks the player up with 1,000 premium gems.",
	price: 100,
};

const START_PLACE: PlaceEntry = {
	filePath: "places/start.rbxl",
};

describe(selectEnvironment, () => {
	it("should return Err(unknownEnvironment) when the env name is not declared", () => {
		expect.assertions(3);

		const config: Config = {
			environments: { production: {} },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(!result.success);
		assert(result.err.kind === "unknownEnvironment");

		expect(result.err.kind).toBe("unknownEnvironment");
		expect(result.err.environment).toBe("staging");
		expect(result.err.declared).toStrictEqual(["production"]);
	});

	it("should leave state absent when neither env nor root declares it", () => {
		expect.assertions(1);

		const config: Config = { environments: { production: {} } };

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.state).toBeUndefined();
	});

	it("should prefer the env state override when both root and env declare state", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: { state: PROD_STATE } },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.state).toBe(PROD_STATE);
	});

	it("should fall back to root state when the env entry has no state override", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: {} },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.state).toBe(ROOT_STATE);
	});

	it("should override only the universe fields the env overlay declares", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				production: { universe: { universeId: "9999999999" } },
			},
			state: ROOT_STATE,
			universe: { universeId: "1111111111", voiceChatEnabled: true },
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.universe?.universeId).toBe("9999999999");
		expect(result.data.universe?.voiceChatEnabled).toBeTrue();
	});

	it("should overlay places onto matching root entries by key while preserving root fields", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: {
					places: { "start-place": { placeId: "5555" } },
				},
			},
			places: { "start-place": START_PLACE },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["start-place"]?.placeId).toBe("5555");
		expect(result.data.places?.["start-place"]?.filePath).toBe("places/start.rbxl");
	});

	it("should preserve every root place that the overlay declares alongside the one it touches", () => {
		expect.assertions(3);

		const config: Config = {
			environments: {
				staging: {
					places: {
						"lobby": { placeId: "2222" },
						"start-place": { placeId: "5555" },
					},
				},
			},
			places: {
				"lobby": { filePath: "places/lobby.rbxl" },
				"start-place": START_PLACE,
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["start-place"]?.placeId).toBe("5555");
		expect(result.data.places?.["lobby"]?.placeId).toBe("2222");
		expect(result.data.places?.["lobby"]?.filePath).toBe("places/lobby.rbxl");
	});

	it("should overlay partial pass fields onto matching root entries by key", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: { passes: { "vip-pass": { price: 250 } } },
			},
			passes: { "vip-pass": VIP_PASS },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.passes?.["vip-pass"]?.price).toBe(250);
		expect(result.data.passes?.["vip-pass"]?.name).toBe("VIP Pass");
	});

	it("should overlay partial product fields onto matching root entries by key", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: { products: { "gem-pack": { price: 250 } } },
			},
			products: { "gem-pack": GEM_PACK },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.products?.["gem-pack"]?.price).toBe(250);
		expect(result.data.products?.["gem-pack"]?.name).toBe("Gem Pack");
	});

	it("should pass a brand-new overlay-only product entry through the projection", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: {
					products: {
						"new-pack": { name: "New Pack", description: "Fresh." },
					},
				},
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.products?.["new-pack"]?.name).toBe("New Pack");
		expect(result.data.products?.["new-pack"]?.description).toBe("Fresh.");
	});

	it("should leave root products intact when the env entry has no products overlay", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: {} },
			products: { "gem-pack": GEM_PACK },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.products).toStrictEqual({ "gem-pack": GEM_PACK });
	});

	it("should accept a brand-new overlay-only place entry when the overlay declares both filePath and placeId", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: {
					places: {
						"debug-place": { filePath: "places/debug.rbxl", placeId: "9999" },
					},
				},
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["debug-place"]?.placeId).toBe("9999");
		expect(result.data.places?.["debug-place"]?.filePath).toBe("places/debug.rbxl");
	});

	it("should return Err(incompletePlaceEntry) for an overlay-only place that omits filePath", () => {
		expect.assertions(4);

		const config: Config = {
			environments: {
				staging: { places: { "debug-place": { placeId: "9999" } } },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(!result.success);
		assert(result.err.kind === "incompletePlaceEntry");

		expect(result.err.environment).toBe("staging");
		expect(result.err.key).toBe("debug-place");
		expect(result.err.missingField).toBe("filePath");
		expect(result.err.kind).toBe("incompletePlaceEntry");
	});

	it("should surface an env-only universe entry when root has no universe block", () => {
		expect.assertions(1);

		const config: Config = {
			environments: {
				production: { universe: { universeId: "9999999999" } },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.universe?.universeId).toBe("9999999999");
	});

	it("should return root resources unchanged when the env entry has no overlays", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				production: {
					places: { "start-place": { placeId: "1111" } },
					state: PROD_STATE,
				},
			},
			passes: { "vip-pass": VIP_PASS },
			places: { "start-place": START_PLACE },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.passes).toStrictEqual({ "vip-pass": VIP_PASS });
		expect(result.data.places).toStrictEqual({
			"start-place": { ...START_PLACE, placeId: "1111" },
		});
	});

	it("should return Err(incompletePlaceEntry) when a root place has no overlay supplying placeId", () => {
		expect.assertions(4);

		const config: Config = {
			environments: { production: {} },
			places: { "start-place": START_PLACE },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(!result.success);
		assert(result.err.kind === "incompletePlaceEntry");

		expect(result.err.kind).toBe("incompletePlaceEntry");
		expect(result.err.environment).toBe("production");
		expect(result.err.key).toBe("start-place");
		expect(result.err.missingField).toBe("placeId");
	});

	it("should return Err(incompletePlaceEntry) for the first incomplete place when several root entries lack overlays", () => {
		expect.assertions(2);

		const config: Config = {
			environments: { production: {} },
			places: {
				alpha: { filePath: "places/alpha.rbxl" },
				beta: { filePath: "places/beta.rbxl" },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(!result.success);
		assert(result.err.kind === "incompletePlaceEntry");

		expect(result.err.key).toBe("alpha");
		expect(result.err.missingField).toBe("placeId");
	});

	it("should accept a root place when the requested environment overlays it with a placeId", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				production: { places: { "start-place": { placeId: "1111" } } },
			},
			places: { "start-place": START_PLACE },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.places?.["start-place"]?.placeId).toBe("1111");
		expect(result.data.places?.["start-place"]?.filePath).toBe("places/start.rbxl");
	});

	it("should preserve environments and extends so the returned shape stays assignable to Config", () => {
		expect.assertions(2);

		const config: Config = {
			environments: { production: { state: PROD_STATE } },
			extends: "./base.config.ts",
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.environments).toContainKey("production");
		expect(result.data.extends).toBe("./base.config.ts");
	});
});
