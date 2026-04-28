import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import { factorizeEnvironments } from "./factorize-environments.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PassFoldEntry } from "./fold-passes.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";

const SAMPLE_HASH = asSha256Hex("86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1");
const VALID_HASH = asSha256Hex("908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9");

function placeFold(overrides: Partial<PlaceFoldEntry> = {}): PlaceFoldEntry {
	return {
		entry: { filePath: "place.rbxl" },
		fileHash: VALID_HASH,
		outputs: { versionNumber: 53 },
		placeId: "17613681043",
		...overrides,
	};
}

function passFold(key: string, overrides: Partial<PassFoldEntry> = {}): PassFoldEntry {
	return {
		key: asResourceKey(key),
		entry: {
			name: "Example Pass",
			description: "This is an example pass.",
			iconFilePath: "assets/marketing/example-icon.png",
			price: 5,
		},
		mantleIconFileHash: SAMPLE_HASH,
		mantlePath: `pass_${key}`,
		outputs: {
			assetId: asRobloxAssetId("838509486"),
			iconAssetId: asRobloxAssetId("18109205439"),
		},
		...overrides,
	};
}

function passWithEntry(key: string, entry: PassFoldEntry["entry"]): PassFoldEntry {
	return passFold(key, { entry });
}

function fold(overrides: Partial<EnvironmentFoldResult> = {}): EnvironmentFoldResult {
	return {
		passes: [],
		places: new Map(),
		universe: undefined,
		warnings: [],
		...overrides,
	};
}

describe(factorizeEnvironments, () => {
	it("should auto-pick the only environment when primaryEnvironment is omitted", () => {
		expect.assertions(2);

		const folds = new Map([["production", fold()]]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: undefined });

		assert(result.success);

		expect(result.data.primaryEnvironment).toBe("production");
		expect(Object.keys(result.data.config.environments)).toStrictEqual(["production"]);
	});

	it("should produce an empty overlay for the only environment when no resources diverge", () => {
		expect.assertions(1);

		const folds = new Map([["production", fold()]]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: undefined });

		assert(result.success);

		expect(result.data.config.environments["production"]).toStrictEqual({});
	});

	it("should return primaryEnvironmentRequired with an empty available list when no environments are declared", () => {
		expect.assertions(2);

		const result = factorizeEnvironments({
			folds: new Map(),
			primaryEnvironment: undefined,
		});

		assert(!result.success);

		expect(result.err.kind).toBe("primaryEnvironmentRequired");

		assert(result.err.kind === "primaryEnvironmentRequired");

		expect(result.err.available).toStrictEqual([]);
	});

	it("should return primaryEnvironmentRequired listing every environment when more than one is present and no primary is supplied", () => {
		expect.assertions(2);

		const folds = new Map([
			["development", fold()],
			["production", fold()],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: undefined });

		assert(!result.success);
		assert(result.err.kind === "primaryEnvironmentRequired");

		expect(result.err.kind).toBe("primaryEnvironmentRequired");
		expect(result.err.available).toStrictEqual(["development", "production"]);
	});

	it("should return primaryEnvironmentNotFound when the supplied primary is not declared", () => {
		expect.assertions(3);

		const folds = new Map([
			["development", fold()],
			["production", fold()],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "staging" });

		assert(!result.success);
		assert(result.err.kind === "primaryEnvironmentNotFound");

		expect(result.err.kind).toBe("primaryEnvironmentNotFound");
		expect(result.err.primary).toBe("staging");
		expect(result.err.available).toStrictEqual(["development", "production"]);
	});

	it("should echo the supplied primary back when it matches a declared environment", () => {
		expect.assertions(1);

		const folds = new Map([
			["development", fold()],
			["production", fold()],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "development" });

		assert(result.success);

		expect(result.data.primaryEnvironment).toBe("development");
	});

	it("should seed the root config from the chosen primary's universe entry", () => {
		expect.assertions(1);

		const folds = new Map([
			[
				"development",
				fold({
					universe: {
						entry: { universeId: "1111111111" },
						outputs: { rootPlaceId: asRobloxAssetId("2222222222") },
					},
				}),
			],
			[
				"production",
				fold({
					universe: {
						entry: { universeId: "6031475575" },
						outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
					},
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.universe?.universeId).toBe("6031475575");
	});

	it("should override universeId on a non-primary overlay when it diverges from the primary", () => {
		expect.assertions(1);

		const folds = new Map([
			[
				"development",
				fold({
					universe: {
						entry: { universeId: "1111111111" },
						outputs: { rootPlaceId: asRobloxAssetId("2222222222") },
					},
				}),
			],
			[
				"production",
				fold({
					universe: {
						entry: { universeId: "6031475575" },
						outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
					},
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.universe).toStrictEqual({
			universeId: "1111111111",
		});
	});

	it("should omit the universe overlay when the env's universe matches the primary's", () => {
		expect.assertions(1);

		const folds = new Map([
			[
				"development",
				fold({
					universe: {
						entry: { universeId: "6031475575" },
						outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
					},
				}),
			],
			[
				"production",
				fold({
					universe: {
						entry: { universeId: "6031475575" },
						outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
					},
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.universe).toBeUndefined();
	});

	it("should seed the root config from the chosen primary's pass entries", () => {
		expect.assertions(2);

		const folds = new Map([
			["development", fold({ passes: [passFold("vip")] })],
			["production", fold({ passes: [passFold("vip")] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.passes).toBeDefined();
		expect(result.data.config.passes?.["vip"]?.name).toBe("Example Pass");
	});

	it("should omit the root passes block when the primary environment has no pass folds", () => {
		expect.assertions(1);

		const folds = new Map([["production", fold()]]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: undefined });

		assert(result.success);

		expect(result.data.config.passes).toBeUndefined();
	});

	it("should override only the divergent pass name on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Pass",
			description: "This is an example pass.",
			iconFilePath: "assets/marketing/example-icon.png",
			price: 5,
		};
		const folds = new Map([
			[
				"development",
				fold({ passes: [passWithEntry("vip", { ...primaryEntry, name: "Dev VIP" })] }),
			],
			["production", fold({ passes: [passWithEntry("vip", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.passes).toStrictEqual({
			vip: { name: "Dev VIP" },
		});
	});

	it("should override only the divergent pass description on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Pass",
			description: "This is an example pass.",
			iconFilePath: "assets/marketing/example-icon.png",
			price: 5,
		};
		const folds = new Map([
			[
				"development",
				fold({
					passes: [passWithEntry("vip", { ...primaryEntry, description: "Dev only." })],
				}),
			],
			["production", fold({ passes: [passWithEntry("vip", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.passes).toStrictEqual({
			vip: { description: "Dev only." },
		});
	});

	it("should override only the divergent pass iconFilePath on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Pass",
			description: "This is an example pass.",
			iconFilePath: "assets/marketing/example-icon.png",
			price: 5,
		};
		const folds = new Map([
			[
				"development",
				fold({
					passes: [
						passWithEntry("vip", {
							...primaryEntry,
							iconFilePath: "assets/dev-icon.png",
						}),
					],
				}),
			],
			["production", fold({ passes: [passWithEntry("vip", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.passes).toStrictEqual({
			vip: { iconFilePath: "assets/dev-icon.png" },
		});
	});

	it("should override only the divergent pass price on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Pass",
			description: "This is an example pass.",
			iconFilePath: "assets/marketing/example-icon.png",
			price: 5,
		};
		const folds = new Map([
			[
				"development",
				fold({ passes: [passWithEntry("vip", { ...primaryEntry, price: 10 })] }),
			],
			["production", fold({ passes: [passWithEntry("vip", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.passes).toStrictEqual({
			vip: { price: 10 },
		});
	});

	it("should carry the full pass entry on a non-primary overlay when the primary lacks the key", () => {
		expect.assertions(1);

		const developmentOnlyEntry = {
			name: "Dev Only Pass",
			description: "Only available in development.",
			iconFilePath: "assets/dev-only.png",
			price: 25,
		};
		const folds = new Map([
			["development", fold({ passes: [passWithEntry("dev-only", developmentOnlyEntry)] })],
			["production", fold({ passes: [] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.passes).toStrictEqual({
			"dev-only": developmentOnlyEntry,
		});
	});

	it("should omit the passes overlay when every pass field matches the primary's pass", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Pass",
			description: "This is an example pass.",
			iconFilePath: "assets/marketing/example-icon.png",
			price: 5,
		};
		const folds = new Map([
			["development", fold({ passes: [passWithEntry("vip", primaryEntry)] })],
			["production", fold({ passes: [passWithEntry("vip", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.passes).toBeUndefined();
	});

	it("should seed the root places block from the primary's place folds", () => {
		expect.assertions(1);

		const folds = new Map([
			["development", fold({ places: new Map([["start", placeFold()]]) })],
			["production", fold({ places: new Map([["start", placeFold()]]) })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places).toStrictEqual({ start: { filePath: "place.rbxl" } });
	});

	it("should put the placeId on the primary environment overlay when filePath matches the primary", () => {
		expect.assertions(1);

		const folds = new Map([
			[
				"development",
				fold({ places: new Map([["start", placeFold({ placeId: "2222222222" })]]) }),
			],
			[
				"production",
				fold({ places: new Map([["start", placeFold({ placeId: "17613681043" })]]) }),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "2222222222" },
		});
	});

	it("should override filePath on a non-primary place overlay when it diverges from the primary", () => {
		expect.assertions(1);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"start",
							placeFold({ entry: { filePath: "place.rbxl" }, placeId: "2222222222" }),
						],
					]),
				}),
			],
			[
				"production",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { filePath: "place.rbxlx" },
								placeId: "17613681043",
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { filePath: "place.rbxl", placeId: "2222222222" },
		});
	});

	it("should emit a resource-missing-from-env interpretive warning when the primary has a universe the env lacks", () => {
		expect.assertions(2);

		const folds = new Map([
			["development", fold()],
			[
				"production",
				fold({
					universe: {
						entry: { universeId: "6031475575" },
						outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
					},
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.warnings).toHaveLength(1);
		expect(result.data.warnings[0]).toStrictEqual({
			bedrockPath: "environments.development.universe",
			kind: "interpretive",
			mantlePath: "development.experience_singleton",
			rule: "factorize-environments/resource-missing-from-env",
		});
	});

	it("should emit a resource-missing-from-env interpretive warning when the env has a universe the primary lacks", () => {
		expect.assertions(2);

		const folds = new Map([
			[
				"development",
				fold({
					universe: {
						entry: { universeId: "1111111111" },
						outputs: { rootPlaceId: asRobloxAssetId("2222222222") },
					},
				}),
			],
			["production", fold()],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.warnings).toHaveLength(1);
		expect(result.data.warnings[0]).toStrictEqual({
			bedrockPath: "environments.development.universe",
			kind: "interpretive",
			mantlePath: "development.experience_singleton",
			rule: "factorize-environments/resource-missing-from-env",
		});
	});

	it("should emit a resource-missing-from-env interpretive warning for a place the env lacks", () => {
		expect.assertions(1);

		const folds = new Map([
			["development", fold()],
			["production", fold({ places: new Map([["start", placeFold()]]) })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.warnings).toContainEqual({
			bedrockPath: "environments.development.places.start",
			kind: "interpretive",
			mantlePath: "development.place_start",
			rule: "factorize-environments/resource-missing-from-env",
		});
	});

	it("should emit a resource-missing-from-env interpretive warning for a pass the env lacks", () => {
		expect.assertions(1);

		const folds = new Map([
			["development", fold()],
			["production", fold({ passes: [passFold("vip")] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.warnings).toContainEqual({
			bedrockPath: "environments.development.passes.vip",
			kind: "interpretive",
			mantlePath: "development.pass_vip",
			rule: "factorize-environments/resource-missing-from-env",
		});
	});

	it("should emit a resource-missing-from-env interpretive warning for a pass that exists only on a non-primary env", () => {
		expect.assertions(1);

		const folds = new Map([
			["development", fold({ passes: [passFold("dev-only")] })],
			["production", fold()],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.warnings).toContainEqual({
			bedrockPath: "environments.development.passes.dev-only",
			kind: "interpretive",
			mantlePath: "development.pass_dev-only",
			rule: "factorize-environments/resource-missing-from-env",
		});
	});

	it("should emit zero warnings when every environment has the same resource set", () => {
		expect.assertions(1);

		const universeBlock = {
			entry: { universeId: "6031475575" },
			outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
		};
		const folds = new Map([
			[
				"development",
				fold({
					passes: [passFold("vip")],
					places: new Map([["start", placeFold()]]),
					universe: universeBlock,
				}),
			],
			[
				"production",
				fold({
					passes: [passFold("vip")],
					places: new Map([["start", placeFold()]]),
					universe: universeBlock,
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.warnings).toStrictEqual([]);
	});

	it("should emit zero warnings on a clean primary-pick happy path", () => {
		expect.assertions(1);

		const folds = new Map([["production", fold()]]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: undefined });

		assert(result.success);

		expect(result.data.warnings).toStrictEqual([]);
	});
});
