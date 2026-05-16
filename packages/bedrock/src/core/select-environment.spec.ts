import { assert, describe, expect, it } from "vitest";

import { REDACTED_DESCRIPTION, REDACTED_PASS_NAME } from "./redact-resources.ts";
import { REDACTED_ICON_PATH } from "./redacted-icon.ts";
import type {
	Config,
	DeveloperProductEntry,
	EnvironmentEntry,
	GamePassEntry,
	PlaceEntry,
	StateConfig,
} from "./schema.ts";
import { selectEnvironment, selectMergedEnvironment } from "./select-environment.ts";

const ROOT_STATE: StateConfig = { backend: "gist", gistId: "root-gist" };
const PROD_STATE: StateConfig = { backend: "gist", gistId: "prod-gist" };

const VIP_PASS: GamePassEntry = {
	name: "VIP Pass",
	description: "Grants VIP perks.",
	icon: { "en-us": "assets/vip.png" },
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
		expect.assertions(2);

		const config: Config = { environments: { production: {} } };

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.state).toBeUndefined();
		expect(result.data).not.toContainKey("state");
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
				production: { universe: { voiceChatEnabled: false } },
			},
			state: ROOT_STATE,
			universe: {
				desktopEnabled: true,
				universeId: "1111111111",
				voiceChatEnabled: true,
			},
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.universe?.voiceChatEnabled).toBeFalse();
		expect(result.data.universe?.desktopEnabled).toBeTrue();
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

	it("should return Err(incompleteUniverseEntry) when neither root nor env overlay supplies universeId", () => {
		expect.assertions(3);

		const config: Config = {
			environments: { production: { universe: { voiceChatEnabled: true } } },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(!result.success);
		assert(result.err.kind === "incompleteUniverseEntry");

		expect(result.err.kind).toBe("incompleteUniverseEntry");
		expect(result.err.missingField).toBe("universeId");
		expect(result.err.environment).toBe("production");
	});

	it("should prefix universe.displayName with the default template when an environment declares a label", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { staging: { label: "staging" } },
			state: ROOT_STATE,
			universe: { displayName: "Anime Rush", universeId: "1234567890" },
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.universe?.displayName).toBe("[STAGING] Anime Rush");
	});

	it("should prefix universe.displayName with the project-supplied custom format", () => {
		expect.assertions(1);

		const config: Config = {
			displayNamePrefix: { format: "{Label} - " },
			environments: { production: { label: "production" } },
			state: ROOT_STATE,
			universe: { displayName: "Anime Rush", universeId: "1234567890" },
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.universe?.displayName).toBe("Production - Anime Rush");
	});

	it("should not prefix universe.displayName when the project disables displayNamePrefix", () => {
		expect.assertions(1);

		const config: Config = {
			displayNamePrefix: { enabled: false },
			environments: { staging: { label: "staging" } },
			state: ROOT_STATE,
			universe: { displayName: "Anime Rush", universeId: "1234567890" },
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.universe?.displayName).toBe("Anime Rush");
	});

	it("should not prefix universe.displayName when the environment has no label", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { staging: {} },
			state: ROOT_STATE,
			universe: { displayName: "Anime Rush", universeId: "1234567890" },
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.universe?.displayName).toBe("Anime Rush");
	});

	it("should treat an empty-string label as opting out of prefixing", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { staging: { label: "" } },
			state: ROOT_STATE,
			universe: { displayName: "Anime Rush", universeId: "1234567890" },
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.universe?.displayName).toBe("Anime Rush");
	});

	it("should leave the universe block untouched when displayName is not declared even with a label", () => {
		expect.assertions(2);

		const config: Config = {
			environments: { staging: { label: "staging" } },
			state: ROOT_STATE,
			universe: { universeId: "1234567890" },
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.universe?.universeId).toBe("1234567890");
		expect(result.data.universe?.displayName).toBeUndefined();
	});

	it("should leave universe absent when no universe block exists, even with prefixing enabled and a label declared", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { staging: { label: "staging" } },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.universe).toBeUndefined();
	});

	it("should prefix every declared place displayName with the rendered template", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: {
					label: "staging",
					places: { "lobby": { placeId: "2222" }, "start-place": { placeId: "5555" } },
				},
			},
			places: {
				"lobby": { displayName: "Lobby", filePath: "places/lobby.rbxl" },
				"start-place": { displayName: "Start Place", filePath: "places/start.rbxl" },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["lobby"]?.displayName).toBe("[STAGING] Lobby");
		expect(result.data.places?.["start-place"]?.displayName).toBe("[STAGING] Start Place");
	});

	it("should apply the prefix to a displayName declared on the per-environment overlay rather than the root", () => {
		expect.assertions(1);

		const config: Config = {
			environments: {
				staging: {
					label: "staging",
					places: {
						"start-place": { displayName: "Dev Lobby", placeId: "5555" },
					},
				},
			},
			places: { "start-place": { filePath: "places/start.rbxl" } },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["start-place"]?.displayName).toBe("[STAGING] Dev Lobby");
	});

	it("should leave a place's displayName untouched when that place declares no displayName", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: {
					label: "staging",
					places: { "lobby": { placeId: "2222" }, "start-place": { placeId: "5555" } },
				},
			},
			places: {
				"lobby": { filePath: "places/lobby.rbxl" },
				"start-place": { displayName: "Start Place", filePath: "places/start.rbxl" },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["lobby"]?.displayName).toBeUndefined();
		expect(result.data.places?.["start-place"]?.displayName).toBe("[STAGING] Start Place");
	});

	it("should not prefix any place displayName when displayNamePrefix.enabled is false", () => {
		expect.assertions(1);

		const config: Config = {
			displayNamePrefix: { enabled: false },
			environments: {
				staging: {
					label: "staging",
					places: { "start-place": { placeId: "5555" } },
				},
			},
			places: {
				"start-place": { displayName: "Start Place", filePath: "places/start.rbxl" },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["start-place"]?.displayName).toBe("Start Place");
	});

	it("should not prefix place displayNames when the environment has no label", () => {
		expect.assertions(1);

		const config: Config = {
			environments: {
				staging: { places: { "start-place": { placeId: "5555" } } },
			},
			places: {
				"start-place": { displayName: "Start Place", filePath: "places/start.rbxl" },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["start-place"]?.displayName).toBe("Start Place");
	});

	it("should apply the project-supplied custom format to every declared place displayName", () => {
		expect.assertions(1);

		const config: Config = {
			displayNamePrefix: { format: "{Label}: " },
			environments: {
				production: {
					label: "production",
					places: { "start-place": { placeId: "5555" } },
				},
			},
			places: {
				"start-place": { displayName: "Start Place", filePath: "places/start.rbxl" },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.places?.["start-place"]?.displayName).toBe("Production: Start Place");
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

	it("should substitute placeholder content when a root pass declares redacted: true", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: {} },
			passes: { "vip-pass": { ...VIP_PASS, redacted: true } },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.passes?.["vip-pass"]).toStrictEqual({
			name: REDACTED_PASS_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			price: 500,
			redacted: true,
		});
	});

	it("should redact a pass when an env-overlay flips redacted to true while the root leaves it unset", () => {
		expect.assertions(1);

		const config: Config = {
			environments: {
				staging: { passes: { "vip-pass": { redacted: true } } },
			},
			passes: { "vip-pass": VIP_PASS },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.passes?.["vip-pass"]?.name).toBe(REDACTED_PASS_NAME);
	});

	it("should push real values when an env-overlay flips redacted to false while the root says true", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				production: { passes: { "vip-pass": { redacted: false } } },
			},
			passes: { "vip-pass": { ...VIP_PASS, redacted: true } },
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "production");

		assert(result.success);

		expect(result.data.passes?.["vip-pass"]?.name).toBe("VIP Pass");
		expect(result.data.passes?.["vip-pass"]?.icon["en-us"]).toBe("assets/vip.png");
	});

	it.for<
		[
			label: string,
			overlay: NonNullable<EnvironmentEntry["passes"]>[string],
			missingField: "description" | "icon" | "name",
		]
	>([
		["name", { description: "x", icon: { "en-us": "x.png" }, redacted: true }, "name"],
		["description", { name: "x", icon: { "en-us": "x.png" }, redacted: true }, "description"],
		["icon", { name: "x", description: "x", redacted: true }, "icon"],
	])(
		"should return Err(incompletePassEntry) when an overlay-only pass omits %s before redaction can substitute placeholders",
		([, overlay, missingField]) => {
			expect.assertions(4);

			const config: Config = {
				environments: {
					staging: { passes: { "vip-pass": overlay } },
				},
				state: ROOT_STATE,
			};

			const result = selectEnvironment(config, "staging");

			assert(!result.success);
			assert(result.err.kind === "incompletePassEntry");

			expect(result.err.environment).toBe("staging");
			expect(result.err.key).toBe("vip-pass");
			expect(result.err.missingField).toBe(missingField);
			expect(result.err.kind).toBe("incompletePassEntry");
		},
	);

	it("should accept an overlay-only redacted pass when the overlay declares name, description, and icon", () => {
		expect.assertions(1);

		const config: Config = {
			environments: {
				staging: {
					passes: {
						"vip-pass": {
							name: "VIP Pass",
							description: "Grants VIP perks.",
							icon: { "en-us": "assets/vip.png" },
							redacted: true,
						},
					},
				},
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.passes?.["vip-pass"]?.name).toBe(REDACTED_PASS_NAME);
	});

	it("should still apply the display-name prefix to places when a redacted pass coexists", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: {
					label: "staging",
					places: { "start-place": { placeId: "5555" } },
				},
			},
			passes: { "vip-pass": { ...VIP_PASS, redacted: true } },
			places: {
				"start-place": { displayName: "Start Place", filePath: "places/start.rbxl" },
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.passes?.["vip-pass"]?.name).toBe(REDACTED_PASS_NAME);
		expect(result.data.places?.["start-place"]?.displayName).toBe("[STAGING] Start Place");
	});

	it("should redact a place description and preserve the real displayName under the prefix when redacted is true", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: {
					label: "staging",
					places: { "start-place": { placeId: "5555" } },
				},
			},
			places: {
				"start-place": {
					description: "The lobby place.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
					redacted: true,
				},
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["start-place"]?.description).toBe(REDACTED_DESCRIPTION);
		expect(result.data.places?.["start-place"]?.displayName).toBe("[STAGING] Start Place");
	});

	it("should compose the display-name prefix with an explicit place displayName override", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				staging: {
					label: "staging",
					places: { "start-place": { placeId: "5555" } },
				},
			},
			places: {
				"start-place": {
					description: "The lobby place.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
					redacted: { displayName: "Hidden" },
				},
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["start-place"]?.description).toBe(REDACTED_DESCRIPTION);
		expect(result.data.places?.["start-place"]?.displayName).toBe("[STAGING] Hidden");
	});

	it("should redact every place description while preserving displayNames when the env-level toggle is true", () => {
		expect.assertions(4);

		const config: Config = {
			environments: {
				staging: {
					label: "staging",
					places: {
						"lobby": { placeId: "2222" },
						"start-place": { placeId: "5555" },
					},
					redacted: true,
				},
			},
			places: {
				"lobby": {
					description: "The hub.",
					displayName: "Lobby",
					filePath: "places/lobby.rbxl",
				},
				"start-place": {
					description: "The lobby place.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
				},
			},
			state: ROOT_STATE,
		};

		const result = selectEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.places?.["lobby"]?.description).toBe(REDACTED_DESCRIPTION);
		expect(result.data.places?.["lobby"]?.displayName).toBe("[STAGING] Lobby");
		expect(result.data.places?.["start-place"]?.description).toBe(REDACTED_DESCRIPTION);
		expect(result.data.places?.["start-place"]?.displayName).toBe("[STAGING] Start Place");
	});
});

describe(selectMergedEnvironment, () => {
	it("should preserve real name, description, and icon on a redacted pass instead of substituting placeholders", () => {
		expect.assertions(3);

		const config: Config = {
			environments: { production: {} },
			passes: { "vip-pass": { ...VIP_PASS, redacted: true } },
		};

		const result = selectMergedEnvironment(config, "production");

		assert(result.success);

		expect(result.data.merged.passes?.["vip-pass"]?.name).toBe(VIP_PASS.name);
		expect(result.data.merged.passes?.["vip-pass"]?.description).toBe(VIP_PASS.description);
		expect(result.data.merged.passes?.["vip-pass"]?.icon["en-us"]).toBe(VIP_PASS.icon["en-us"]);
	});

	it("should leave a place displayName unprefixed even when the env declares a label", () => {
		expect.assertions(1);

		const config: Config = {
			environments: {
				staging: {
					label: "staging",
					places: { "start-place": { placeId: "5555" } },
				},
			},
			places: {
				"start-place": { displayName: "Start Place", filePath: "places/start.rbxl" },
			},
		};

		const result = selectMergedEnvironment(config, "staging");

		assert(result.success);

		expect(result.data.merged.places?.["start-place"]?.displayName).toBe("Start Place");
	});

	it("should return the matched env entry alongside the merged config", () => {
		expect.assertions(1);

		const productionEntry = { label: "prod" };
		const config: Config = {
			environments: { production: productionEntry },
		};

		const result = selectMergedEnvironment(config, "production");

		assert(result.success);

		expect(result.data.entry).toBe(productionEntry);
	});

	it("should return Err(unknownEnvironment) when the env name is not declared", () => {
		expect.assertions(1);

		const config: Config = { environments: { production: {} } };

		const result = selectMergedEnvironment(config, "staging");

		assert(!result.success);

		expect(result.err.kind).toBe("unknownEnvironment");
	});

	it("should return Err(incompletePassEntry) when an overlay-only pass lacks required fields", () => {
		expect.assertions(2);

		const config: Config = {
			environments: {
				production: { passes: { ghost: { redacted: true } } },
			},
		};

		const result = selectMergedEnvironment(config, "production");

		assert(!result.success);
		assert(result.err.kind === "incompletePassEntry");

		expect(result.err.kind).toBe("incompletePassEntry");
		expect(result.err.key).toBe("ghost");
	});

	it("should return Err(incompletePlaceEntry) for a root place that no overlay completes, matching selectEnvironment", () => {
		expect.assertions(3);

		const config: Config = {
			environments: { production: {} },
			places: { "ghost-place": { filePath: "places/ghost.rbxl" } },
		};

		const mergedResult = selectMergedEnvironment(config, "production");

		assert(!mergedResult.success);
		assert(mergedResult.err.kind === "incompletePlaceEntry");

		expect(mergedResult.err.kind).toBe("incompletePlaceEntry");
		expect(mergedResult.err.key).toBe("ghost-place");
		expect(mergedResult.err.missingField).toBe("placeId");
	});
});
