import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import { factorizeEnvironments } from "./factorize-environments.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PassFoldEntry } from "./fold-passes.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";
import type { ProductFoldEntry } from "./fold-products.ts";

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
			icon: { "en-us": "assets/marketing/example-icon.png" },
			price: 5,
		},
		mantleIconFileHashes: { "en-us": SAMPLE_HASH },
		mantlePath: `pass_${key}`,
		outputs: {
			assetId: asRobloxAssetId("838509486"),
			iconAssetIds: { "en-us": asRobloxAssetId("18109205439") },
		},
		...overrides,
	};
}

function passWithEntry(key: string, entry: PassFoldEntry["entry"]): PassFoldEntry {
	return passFold(key, { entry });
}

function productFold(key: string, overrides: Partial<ProductFoldEntry> = {}): ProductFoldEntry {
	return {
		key: asResourceKey(key),
		entry: {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
		},
		mantlePath: `product_${key}`,
		outputs: {
			iconImageAssetId: undefined,
			productId: asRobloxAssetId("987654321"),
		},
		...overrides,
	};
}

function productWithEntry(key: string, entry: ProductFoldEntry["entry"]): ProductFoldEntry {
	return productFold(key, { entry });
}

function fold(overrides: Partial<EnvironmentFoldResult> = {}): EnvironmentFoldResult {
	return {
		passes: [],
		places: new Map(),
		products: [],
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

	it("should seed the root universeId from the chosen primary when every environment shares the same universe", () => {
		expect.assertions(2);

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

		expect(result.data.config.universe?.universeId).toBe("6031475575");
		expect(result.data.config.environments["development"]?.universe).toBeUndefined();
	});

	it("should omit universeId from the root universe block when universes diverge across environments", () => {
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

		expect(result.data.config.universe).toBeUndefined();
	});

	it("should write a per-environment universeId overlay for every environment when universes diverge", () => {
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
		expect(result.data.config.environments["production"]?.universe).toStrictEqual({
			universeId: "6031475575",
		});
	});

	it("should keep universeId on the root when one env has the universe and another env has no universe at all", () => {
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

		expect(result.data.config.universe?.universeId).toBe("6031475575");
		expect(result.data.config.environments["production"]?.universe).toBeUndefined();
	});

	it("should preserve shared root universe fields while omitting universeId when universes diverge", () => {
		expect.assertions(2);

		const folds = new Map([
			[
				"development",
				fold({
					universe: {
						entry: { displayName: "Shared Name", universeId: "1111111111" },
						outputs: { rootPlaceId: asRobloxAssetId("2222222222") },
					},
				}),
			],
			[
				"production",
				fold({
					universe: {
						entry: { displayName: "Shared Name", universeId: "6031475575" },
						outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
					},
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.universe?.displayName).toBe("Shared Name");
		expect(result.data.config.universe?.universeId).toBeUndefined();
	});

	it("should omit the universe overlay when the env's universe matches the primary's and every env shares the same universe", () => {
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
			icon: { "en-us": "assets/marketing/example-icon.png" },
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
			icon: { "en-us": "assets/marketing/example-icon.png" },
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

	it("should override only the divergent pass icon on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Pass",
			description: "This is an example pass.",
			icon: { "en-us": "assets/marketing/example-icon.png" },
			price: 5,
		};
		const folds = new Map([
			[
				"development",
				fold({
					passes: [
						passWithEntry("vip", {
							...primaryEntry,
							icon: { "en-us": "assets/dev-icon.png" },
						}),
					],
				}),
			],
			["production", fold({ passes: [passWithEntry("vip", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.passes).toStrictEqual({
			vip: { icon: { "en-us": "assets/dev-icon.png" } },
		});
	});

	it("should override only the divergent pass price on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Pass",
			description: "This is an example pass.",
			icon: { "en-us": "assets/marketing/example-icon.png" },
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
			icon: { "en-us": "assets/dev-only.png" },
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

	it("should omit price from a non-primary overlay when the carried entry has no price", () => {
		expect.assertions(2);

		const offSaleEntry = {
			name: "Off Sale Pass",
			description: "Free preview pass.",
			icon: { "en-us": "assets/off-sale.png" },
		};
		const folds = new Map([
			["development", fold({ passes: [passWithEntry("off-sale", offSaleEntry)] })],
			["production", fold({ passes: [] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		const overlay = result.data.config.environments["development"]?.passes?.["off-sale"];

		expect(overlay).toStrictEqual(offSaleEntry);
		expect(overlay).not.toContainKey("price");
	});

	it("should carry every divergent pass field on a non-primary overlay when several diverge at once", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Pass",
			description: "This is an example pass.",
			icon: { "en-us": "assets/marketing/example-icon.png" },
			price: 5,
		};
		const folds = new Map([
			[
				"development",
				fold({
					passes: [passWithEntry("vip", { ...primaryEntry, name: "Dev VIP", price: 10 })],
				}),
			],
			["production", fold({ passes: [passWithEntry("vip", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.passes).toStrictEqual({
			vip: { name: "Dev VIP", price: 10 },
		});
	});

	it("should omit the passes overlay when every pass field matches the primary's pass", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Pass",
			description: "This is an example pass.",
			icon: { "en-us": "assets/marketing/example-icon.png" },
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

	it("should land description on root and omit the place overlay when both environments share the same description", () => {
		expect.assertions(2);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { description: "Shared place.", filePath: "place.rbxl" },
							}),
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
								entry: { description: "Shared place.", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.description).toBe("Shared place.");
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
	});

	it("should omit description from root and put each env's value on its overlay when description diverges across environments", () => {
		expect.assertions(3);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { description: "Dev place.", filePath: "place.rbxl" },
							}),
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
								entry: { description: "Prod place.", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.description).toBeUndefined();
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { description: "Dev place.", placeId: "17613681043" },
		});
		expect(result.data.config.environments["production"]?.places).toStrictEqual({
			start: { description: "Prod place.", placeId: "17613681043" },
		});
	});

	it("should omit description from root and from the omitting env's overlay when the primary has it and another env lacks it", () => {
		expect.assertions(3);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([["start", placeFold({ entry: { filePath: "place.rbxl" } })]]),
				}),
			],
			[
				"production",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { description: "Prod place.", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.description).toBeUndefined();
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
		expect(result.data.config.environments["production"]?.places).toStrictEqual({
			start: { description: "Prod place.", placeId: "17613681043" },
		});
	});

	it("should land displayName on root and omit the place overlay when both environments share the same displayName", () => {
		expect.assertions(2);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { displayName: "Shared Name", filePath: "place.rbxl" },
							}),
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
								entry: { displayName: "Shared Name", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.displayName).toBe("Shared Name");
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
	});

	it("should omit displayName from root and put each env's value on its overlay when displayName diverges across environments", () => {
		expect.assertions(3);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { displayName: "Dev Name", filePath: "place.rbxl" },
							}),
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
								entry: { displayName: "Prod Name", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.displayName).toBeUndefined();
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { displayName: "Dev Name", placeId: "17613681043" },
		});
		expect(result.data.config.environments["production"]?.places).toStrictEqual({
			start: { displayName: "Prod Name", placeId: "17613681043" },
		});
	});

	it("should omit displayName from root and from the omitting env's overlay when the primary has it and another env lacks it", () => {
		expect.assertions(3);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([["start", placeFold({ entry: { filePath: "place.rbxl" } })]]),
				}),
			],
			[
				"production",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { displayName: "Prod Name", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.displayName).toBeUndefined();
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
		expect(result.data.config.environments["production"]?.places).toStrictEqual({
			start: { displayName: "Prod Name", placeId: "17613681043" },
		});
	});

	it("should land displayName on root when only one environment has the place and that env's entry carries a displayName", () => {
		expect.assertions(1);

		const folds = new Map([
			["development", fold()],
			[
				"production",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { displayName: "Solo Name", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.displayName).toBe("Solo Name");
	});

	it("should lift the unprefixed displayName to root and label the environment when every place in an env shares a bracketed prefix", () => {
		expect.assertions(4);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: {
									displayName: "[DEVELOPMENT] Anime Rush Match",
									filePath: "game.rbxl",
								},
							}),
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
								entry: { displayName: "Anime Rush Match", filePath: "game.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.displayName).toBe("Anime Rush Match");
		expect(result.data.config.environments["development"]?.label).toBe("development");
		expect(result.data.config.environments["production"]?.label).toBeUndefined();
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
	});

	it("should keep the raw displayName on the env overlay when an environment mixes prefixed and unprefixed display names", () => {
		expect.assertions(3);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"game",
							placeFold({
								entry: { displayName: "[DEV] Match", filePath: "place.rbxl" },
							}),
						],
						[
							"start",
							placeFold({ entry: { displayName: "Lobby", filePath: "place.rbxl" } }),
						],
					]),
				}),
			],
			[
				"production",
				fold({
					places: new Map([
						[
							"game",
							placeFold({ entry: { displayName: "Match", filePath: "place.rbxl" } }),
						],
						[
							"start",
							placeFold({ entry: { displayName: "Lobby", filePath: "place.rbxl" } }),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.label).toBeUndefined();
		expect(result.data.config.places?.["game"]?.displayName).toBeUndefined();
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			game: { displayName: "[DEV] Match", placeId: "17613681043" },
			start: { placeId: "17613681043" },
		});
	});

	it("should lift the shared body to root and label each environment when every env carries a different bracketed prefix on the same body", () => {
		expect.assertions(4);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { displayName: "[DEV] Lobby", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
			[
				"staging",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { displayName: "[STAGING] Lobby", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "staging" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.displayName).toBe("Lobby");
		expect(result.data.config.environments["development"]?.label).toBe("dev");
		expect(result.data.config.environments["staging"]?.label).toBe("staging");
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
	});

	it("should put stripped per-environment overlays on each labeled environment when stripped bodies disagree across envs", () => {
		expect.assertions(4);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { displayName: "[DEV] Lobby", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
			[
				"staging",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: { displayName: "[STAGING] Foyer", filePath: "place.rbxl" },
							}),
						],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "staging" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.displayName).toBeUndefined();
		expect(result.data.config.environments["development"]?.label).toBe("dev");
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { displayName: "Lobby", placeId: "17613681043" },
		});
		expect(result.data.config.environments["staging"]?.places).toStrictEqual({
			start: { displayName: "Foyer", placeId: "17613681043" },
		});
	});

	it("should preserve the universe displayName verbatim when the primary environment has no label", () => {
		expect.assertions(2);

		const folds = new Map([
			[
				"production",
				fold({
					places: new Map([
						[
							"start",
							placeFold({ entry: { displayName: "Lobby", filePath: "place.rbxl" } }),
						],
					]),
					universe: {
						entry: { displayName: "[BETA] My Game", universeId: "1234567890" },
						outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
					},
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.universe?.displayName).toBe("[BETA] My Game");
		expect(result.data.config.environments["production"]?.label).toBeUndefined();
	});

	it("should strip the primary environment's display-name prefix from the root universe entry when the env has a label", () => {
		expect.assertions(2);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						[
							"start",
							placeFold({
								entry: {
									displayName: "[DEVELOPMENT] Lobby",
									filePath: "place.rbxl",
								},
							}),
						],
					]),
					universe: {
						entry: {
							displayName: "[DEVELOPMENT] My Game",
							universeId: "1111111111",
						},
						outputs: { rootPlaceId: asRobloxAssetId("2222222222") },
					},
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "development" });

		assert(result.success);

		expect(result.data.config.universe?.displayName).toBe("My Game");
		expect(result.data.config.environments["development"]?.label).toBe("development");
	});

	it("should land serverSize on root and omit the place overlay when both environments share the same serverSize", () => {
		expect.assertions(2);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						["start", placeFold({ entry: { filePath: "place.rbxl", serverSize: 50 } })],
					]),
				}),
			],
			[
				"production",
				fold({
					places: new Map([
						["start", placeFold({ entry: { filePath: "place.rbxl", serverSize: 50 } })],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.serverSize).toBe(50);
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
	});

	it("should omit serverSize from root and put each env's value on its overlay when serverSize diverges across environments", () => {
		expect.assertions(3);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([
						["start", placeFold({ entry: { filePath: "place.rbxl", serverSize: 25 } })],
					]),
				}),
			],
			[
				"production",
				fold({
					places: new Map([
						["start", placeFold({ entry: { filePath: "place.rbxl", serverSize: 50 } })],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.serverSize).toBeUndefined();
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "17613681043", serverSize: 25 },
		});
		expect(result.data.config.environments["production"]?.places).toStrictEqual({
			start: { placeId: "17613681043", serverSize: 50 },
		});
	});

	it("should omit serverSize from root and from the omitting env's overlay when the primary has it and another env lacks it", () => {
		expect.assertions(3);

		const folds = new Map([
			[
				"development",
				fold({
					places: new Map([["start", placeFold({ entry: { filePath: "place.rbxl" } })]]),
				}),
			],
			[
				"production",
				fold({
					places: new Map([
						["start", placeFold({ entry: { filePath: "place.rbxl", serverSize: 50 } })],
					]),
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.places?.["start"]?.serverSize).toBeUndefined();
		expect(result.data.config.environments["development"]?.places).toStrictEqual({
			start: { placeId: "17613681043" },
		});
		expect(result.data.config.environments["production"]?.places).toStrictEqual({
			start: { placeId: "17613681043", serverSize: 50 },
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

	it("should expose folded products on the root config when only one environment exists", () => {
		expect.assertions(2);

		const folds = new Map([["production", fold({ products: [productFold("starter-pack")] })]]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: undefined });

		assert(result.success);

		expect(result.data.config.products).toBeDefined();
		expect(result.data.config.products?.["starter-pack"]?.name).toBe("Example Product");
	});

	it("should hoist a product identical across all environments to the root only", () => {
		expect.assertions(2);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
		};
		const folds = new Map([
			["development", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.products?.["starter-pack"]).toStrictEqual(primaryEntry);
		expect(result.data.config.environments["development"]?.products).toBeUndefined();
	});

	it("should emit a per-environment overlay carrying only the diverging fields", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
		};
		const folds = new Map([
			[
				"development",
				fold({
					products: [productWithEntry("starter-pack", { ...primaryEntry, price: 50 })],
				}),
			],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.products).toStrictEqual({
			"starter-pack": { price: 50 },
		});
	});

	it("should diff icon paths via icon[en-us] when the primary product has an icon", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			icon: { "en-us": "assets/marketing/product-icon.png" },
			price: 100,
		};
		const folds = new Map([
			[
				"development",
				fold({
					products: [
						productWithEntry("starter-pack", {
							...primaryEntry,
							icon: { "en-us": "assets/dev-product-icon.png" },
						}),
					],
				}),
			],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.products).toStrictEqual({
			"starter-pack": { icon: { "en-us": "assets/dev-product-icon.png" } },
		});
	});

	it("should treat a primary without an icon and an overlay with an icon as a divergence", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
		};
		const overlayEntry = {
			...primaryEntry,
			icon: { "en-us": "assets/dev-product-icon.png" },
		};
		const folds = new Map([
			["development", fold({ products: [productWithEntry("starter-pack", overlayEntry)] })],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.products).toStrictEqual({
			"starter-pack": { icon: { "en-us": "assets/dev-product-icon.png" } },
		});
	});

	it("should emit a `factorize-environments/resource-missing-from-env` warning when a product is missing in a non-primary environment", () => {
		expect.assertions(1);

		const folds = new Map([
			["development", fold()],
			["production", fold({ products: [productFold("starter-pack")] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.warnings).toContainEqual({
			bedrockPath: "environments.development.products.starter-pack",
			kind: "interpretive",
			mantlePath: "development.product_starter-pack",
			rule: "factorize-environments/resource-missing-from-env",
		});
	});

	it("should emit the same warning when a product is present only in a non-primary environment", () => {
		expect.assertions(1);

		const folds = new Map([
			["development", fold({ products: [productFold("dev-only")] })],
			["production", fold()],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.warnings).toContainEqual({
			bedrockPath: "environments.development.products.dev-only",
			kind: "interpretive",
			mantlePath: "development.product_dev-only",
			rule: "factorize-environments/resource-missing-from-env",
		});
	});

	it("should pass through unchanged products without emitting an empty overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
		};
		const folds = new Map([
			["development", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.products).toBeUndefined();
	});

	it("should override only the divergent product name on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
		};
		const folds = new Map([
			[
				"development",
				fold({
					products: [
						productWithEntry("starter-pack", { ...primaryEntry, name: "Dev Pack" }),
					],
				}),
			],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.products).toStrictEqual({
			"starter-pack": { name: "Dev Pack" },
		});
	});

	it("should override only the divergent product description on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
		};
		const folds = new Map([
			[
				"development",
				fold({
					products: [
						productWithEntry("starter-pack", {
							...primaryEntry,
							description: "Dev only.",
						}),
					],
				}),
			],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.products).toStrictEqual({
			"starter-pack": { description: "Dev only." },
		});
	});

	it("should override only the divergent isRegionalPricingEnabled on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			isRegionalPricingEnabled: false,
			price: 100,
		};
		const folds = new Map([
			[
				"development",
				fold({
					products: [
						productWithEntry("starter-pack", {
							...primaryEntry,
							isRegionalPricingEnabled: true,
						}),
					],
				}),
			],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.products).toStrictEqual({
			"starter-pack": { isRegionalPricingEnabled: true },
		});
	});

	it("should override only the divergent storePageEnabled on a non-primary overlay", () => {
		expect.assertions(1);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
			storePageEnabled: false,
		};
		const folds = new Map([
			[
				"development",
				fold({
					products: [
						productWithEntry("starter-pack", {
							...primaryEntry,
							storePageEnabled: true,
						}),
					],
				}),
			],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.products).toStrictEqual({
			"starter-pack": { storePageEnabled: true },
		});
	});

	it("should carry the full product entry on a non-primary overlay when the primary lacks the key", () => {
		expect.assertions(1);

		const developmentOnlyEntry = {
			name: "Dev Only Product",
			description: "Only available in development.",
			price: 25,
		};
		const folds = new Map([
			[
				"development",
				fold({ products: [productWithEntry("dev-only", developmentOnlyEntry)] }),
			],
			["production", fold({ products: [] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.environments["development"]?.products).toStrictEqual({
			"dev-only": developmentOnlyEntry,
		});
	});

	it("should keep a divergent optional field off root so non-primary envs that omit it stay omitted after merge", () => {
		expect.assertions(2);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
		};
		const folds = new Map([
			[
				"development",
				fold({
					products: [
						productWithEntry("starter-pack", {
							name: "Example Product",
							description: "This is an example product.",
						}),
					],
				}),
			],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.products?.["starter-pack"]).toStrictEqual({
			name: "Example Product",
			description: "This is an example product.",
		});
		expect(result.data.config.environments["production"]?.products).toStrictEqual({
			"starter-pack": { price: 100 },
		});
	});

	it("should hoist a product icon to root when every environment shares the same icon path", () => {
		expect.assertions(2);

		const folds = new Map([
			[
				"development",
				fold({
					products: [
						productWithEntry("starter-pack", {
							name: "Example Product",
							description: "This is an example product.",
							icon: { "en-us": "assets/marketing/product-icon.png" },
							price: 100,
						}),
					],
				}),
			],
			[
				"production",
				fold({
					products: [
						productWithEntry("starter-pack", {
							name: "Example Product",
							description: "This is an example product.",
							icon: { "en-us": "assets/marketing/product-icon.png" },
							price: 100,
						}),
					],
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.products?.["starter-pack"]?.icon).toStrictEqual({
			"en-us": "assets/marketing/product-icon.png",
		});
		expect(result.data.config.environments["development"]?.products).toBeUndefined();
	});

	it("should hoist a shared isRegionalPricingEnabled flag to root when every environment agrees", () => {
		expect.assertions(2);

		const sharedEntry = {
			name: "Example Product",
			description: "This is an example product.",
			isRegionalPricingEnabled: true,
			price: 100,
		};
		const folds = new Map([
			["development", fold({ products: [productWithEntry("starter-pack", sharedEntry)] })],
			["production", fold({ products: [productWithEntry("starter-pack", sharedEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.products?.["starter-pack"]?.isRegionalPricingEnabled).toBeTrue();
		expect(result.data.config.environments["development"]?.products).toBeUndefined();
	});

	it("should hoist a shared storePageEnabled flag to root when every environment agrees", () => {
		expect.assertions(2);

		const sharedEntry = {
			name: "Example Product",
			description: "This is an example product.",
			price: 100,
			storePageEnabled: false,
		};
		const folds = new Map([
			["development", fold({ products: [productWithEntry("starter-pack", sharedEntry)] })],
			["production", fold({ products: [productWithEntry("starter-pack", sharedEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.products?.["starter-pack"]?.storePageEnabled).toBeFalse();
		expect(result.data.config.environments["development"]?.products).toBeUndefined();
	});

	it("should compute consensus per product key when an environment has multiple products", () => {
		expect.assertions(2);

		const alphaEntry = {
			name: "Alpha Pack",
			description: "Alpha description.",
			price: 10,
		};
		const betaEntry = {
			name: "Beta Pack",
			description: "Beta description.",
			price: 200,
		};
		const folds = new Map([
			[
				"development",
				fold({
					products: [
						productWithEntry("alpha", alphaEntry),
						productWithEntry("beta", betaEntry),
					],
				}),
			],
			[
				"production",
				fold({
					products: [
						productWithEntry("alpha", alphaEntry),
						productWithEntry("beta", betaEntry),
					],
				}),
			],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.products?.["alpha"]?.price).toBe(10);
		expect(result.data.config.products?.["beta"]?.price).toBe(200);
	});

	it("should keep a divergent icon off root so a non-primary env without one does not inherit it", () => {
		expect.assertions(2);

		const primaryEntry = {
			name: "Example Product",
			description: "This is an example product.",
			icon: { "en-us": "assets/marketing/product-icon.png" },
			price: 100,
		};
		const folds = new Map([
			[
				"development",
				fold({
					products: [
						productWithEntry("starter-pack", {
							name: "Example Product",
							description: "This is an example product.",
							price: 100,
						}),
					],
				}),
			],
			["production", fold({ products: [productWithEntry("starter-pack", primaryEntry)] })],
		]);

		const result = factorizeEnvironments({ folds, primaryEnvironment: "production" });

		assert(result.success);

		expect(result.data.config.products?.["starter-pack"]?.icon).toBeUndefined();
		expect(result.data.config.environments["production"]?.products).toStrictEqual({
			"starter-pack": { icon: { "en-us": "assets/marketing/product-icon.png" } },
		});
	});
});
