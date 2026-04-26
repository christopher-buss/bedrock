import { assert, describe, expect, it } from "vitest";

import type { Config, GamePassEntry, PlaceEntry, StateConfig } from "./schema.ts";
import { selectEnvironment } from "./select-environment.ts";

const ROOT_STATE: StateConfig = { backend: "gist", gistId: "root-gist" };
const PROD_STATE: StateConfig = { backend: "gist", gistId: "prod-gist" };

const VIP_PASS: GamePassEntry = {
	name: "VIP Pass",
	description: "Grants VIP perks.",
	iconFilePath: "assets/vip.png",
	price: 500,
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

	it("should preserve root entries that the overlay does not mention", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: { places: { "start-place": { placeId: "5555" } } },
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
		expect(result.data.places?.["lobby"]).toStrictEqual({
			filePath: "places/lobby.rbxl",
		});
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

	it("should surface a brand-new overlay-only place entry when root has no matching key", () => {
		expect.assertions(1);

		const config: Config = {
			environments: {
				staging: { places: { "debug-place": { placeId: "9999" } } },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["debug-place"]).toStrictEqual({ placeId: "9999" });
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
			environments: { production: { state: PROD_STATE } },
			passes: { "vip-pass": VIP_PASS },
			places: { "start-place": START_PLACE },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.passes).toStrictEqual({ "vip-pass": VIP_PASS });
		expect(result.data.places).toStrictEqual({ "start-place": START_PLACE });
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
