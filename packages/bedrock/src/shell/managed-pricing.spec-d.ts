import { describe, expectTypeOf, it } from "vitest";

import { none } from "../core/none.ts";
import type { DeveloperProductEntry, GamePassEntry, ResourceEntry } from "../core/schema.ts";
import { defineConfig } from "./define-config.ts";

const ENTRY = { name: "VIP", description: "Perks", icon: { "en-us": "vip.png" } };

describe("managed pricing authoring", () => {
	it("should preserve config typo checking while inferring pricing", () => {
		// @ts-expect-error -- unknown root config fields remain invalid
		defineConfig({ environments: { production: {} }, unexpected: 1 });
		// @ts-expect-error -- misspelled environment collections remain invalid
		defineConfig({ environments: { production: { product: {} } } });
		const invalidEntry = {
			environments: { production: {} },
			products: { gems: { ...ENTRY, cost: 100 } },
		} as const;
		const invalidUniverse = {
			environments: { production: {} },
			universe: { title: "Game", universeId: "123" },
		} as const;
		// @ts-expect-error -- misspelled entry fields remain invalid
		defineConfig(invalidEntry);
		// @ts-expect-error -- misspelled universe fields remain invalid
		defineConfig(invalidUniverse);
	});

	it("should preserve mutable environment maps and dynamic lookups", () => {
		function fromName(name: string) {
			const config = defineConfig({ environments: { production: {}, staging: {} } });
			config.environments["production"] = {};
			config.environments[name] = {};
			return config.environments[name];
		}

		const sync = defineConfig(() => ({ environments: { production: {} } }));
		const asyncConfig = defineConfig(async () => ({ environments: { production: {} } }));
		type SyncEnvironment = ReturnType<typeof sync>["environments"][string];
		type AsyncEnvironment = Awaited<ReturnType<typeof asyncConfig>>["environments"][string];

		expectTypeOf(fromName).toBeFunction();
		expectTypeOf(sync).toBeFunction();
		expectTypeOf(asyncConfig).toBeFunction();
		expectTypeOf<SyncEnvironment>().toEqualTypeOf<AsyncEnvironment>();
	});

	it("should require a root price when managed pricing is enabled", () => {
		expectTypeOf<{
			description: string;
			isManagedPricingEnabled: true;
			name: string;
		}>().not.toExtend<DeveloperProductEntry>();
		expectTypeOf<
			typeof ENTRY & { isManagedPricingEnabled: true }
		>().not.toExtend<GamePassEntry>();
		expectTypeOf<
			typeof ENTRY & { isManagedPricingEnabled: true; price: typeof none }
		>().not.toExtend<GamePassEntry>();
	});

	it("should accept an overlay that enables managed pricing with an inherited price", () => {
		const config = defineConfig({
			environments: {
				production: {
					passes: { vip: { isManagedPricingEnabled: true } },
					products: { gems: { isManagedPricingEnabled: true } },
				},
			},
			passes: { vip: { ...ENTRY, price: 100 } },
			products: { gems: { ...ENTRY, price: 100 } },
		});

		expectTypeOf(config).toHaveProperty("environments");
	});

	it("should reject an overlay enabling managed pricing without an inherited or own price", () => {
		const products = {
			environments: { production: { products: { gems: { isManagedPricingEnabled: true } } } },
			products: { gems: ENTRY },
		} as const;
		const passes = {
			environments: { production: { passes: { vip: { isManagedPricingEnabled: true } } } },
			passes: { vip: ENTRY },
		} as const;
		// @ts-expect-error -- the root product has no price to inherit
		defineConfig(products);
		// @ts-expect-error -- the root pass has no price to inherit
		defineConfig(passes);
	});

	it("should reject removing an inherited price while managed pricing stays enabled", () => {
		const products = {
			environments: { production: { products: { gems: { price: none } } } },
			products: { gems: { ...ENTRY, isManagedPricingEnabled: true, price: 100 } },
		} as const;
		const passes = {
			environments: {
				production: { passes: { vip: { isManagedPricingEnabled: true, price: none } } },
			},
			passes: { vip: { ...ENTRY, price: 100 } },
		} as const;
		// @ts-expect-error -- managed pricing remains enabled after this overlay
		defineConfig(products);
		// @ts-expect-error -- the overlay enables managed pricing and removes
		// its price
		defineConfig(passes);
	});

	it("should accept an overlay supplying its own price or turning managed pricing off", () => {
		const config = defineConfig({
			environments: {
				production: {
					passes: { vip: { isManagedPricingEnabled: true, price: 100 } },
					products: { gems: { isManagedPricingEnabled: false, price: none } },
				},
			},
			passes: { vip: ENTRY },
			products: { gems: { ...ENTRY, isManagedPricingEnabled: true, price: 100 } },
		});

		expectTypeOf(config).toHaveProperty("environments");
	});

	it("should preserve price inference in synchronous and asynchronous config functions", () => {
		const sync = defineConfig(() => {
			return {
				environments: {
					production: { products: { gems: { isManagedPricingEnabled: true } } },
				},
				products: { gems: { ...ENTRY, price: 100 } },
			};
		});
		const asyncConfig = defineConfig(async () => {
			return {
				environments: {
					production: { passes: { vip: { isManagedPricingEnabled: true } } },
				},
				passes: { vip: { ...ENTRY, price: 100 } },
			};
		});

		expectTypeOf(sync).toBeFunction();
		expectTypeOf(asyncConfig).toBeFunction();
	});

	it("should reject an overlay-only entry enabling managed pricing without its own price", () => {
		const invalid = {
			environments: {
				production: { products: { gems: { ...ENTRY, isManagedPricingEnabled: true } } },
			},
		} as const;
		// @ts-expect-error -- this entry has no root price to inherit
		defineConfig(invalid);
		const valid = defineConfig({
			environments: {
				production: {
					products: { gems: { ...ENTRY, isManagedPricingEnabled: true, price: 0 } },
				},
			},
		});

		expectTypeOf(valid).toHaveProperty("environments");
	});

	it("should inherit a price only from the matching resource key", () => {
		const invalid = {
			environments: {
				production: { products: { unpriced: { isManagedPricingEnabled: true } } },
			},
			products: { priced: { ...ENTRY, price: 100 }, unpriced: ENTRY },
		} as const;
		// @ts-expect-error -- the other product's price does not apply to
		// unpriced
		defineConfig(invalid);
	});

	it("should reject invalid managed pricing returned by config functions", () => {
		function sync() {
			return {
				environments: {
					production: { products: { gems: { isManagedPricingEnabled: true } } },
				},
				products: { gems: ENTRY },
			};
		}

		async function configAsync() {
			return {
				environments: {
					production: { passes: { vip: { isManagedPricingEnabled: true } } },
				},
				passes: { vip: ENTRY },
			};
		}

		// @ts-expect-error -- the synchronous config's overlay has no price
		defineConfig(sync);
		// @ts-expect-error -- the asynchronous config's overlay has no price
		defineConfig(configAsync);
	});

	it("should require a price for a boolean that may enable managed pricing", () => {
		function fromFlag(enabled: boolean) {
			const valid = defineConfig({
				environments: {
					production: { products: { gems: { isManagedPricingEnabled: enabled } } },
				},
				products: { gems: { ...ENTRY, price: 100 } },
			});
			const invalid = {
				environments: {
					production: { products: { gems: { isManagedPricingEnabled: enabled } } },
				},
				products: { gems: ENTRY },
			};
			// @ts-expect-error -- an unknown boolean may enable managed pricing
			defineConfig(invalid);
			return valid;
		}

		expectTypeOf(fromFlag).toBeFunction();
	});
});

// Control entries replace live pricing rather than inheriting its requirement.
defineConfig({
	environments: {
		production: {
			passes: { vip: { retired: "untrack" } },
			products: { gems: { retired: "untrack" } },
		},
	},
	passes: { vip: { ...ENTRY, isManagedPricingEnabled: true, price: 100 } },
	products: { gems: { ...ENTRY, isManagedPricingEnabled: true, price: 100 } },
});
defineConfig({
	environments: { production: {} },
	passes: { vip: { retired: "untrack" } },
	products: { gems: { retired: "untrack" } },
});
const mixedPricingMarker = {
	environments: { production: {} },
	products: { gems: { isManagedPricingEnabled: true, price: 100, retired: "untrack" } },
} as const;
// @ts-expect-error -- markers remain exclusive even with pricing inference
defineConfig(mixedPricingMarker);

defineConfig({
	environments: { production: { products: { gems: { isManagedPricingEnabled: true } } } },
	products: { gems: { retired: "untrack" } },
});

/**
 * A possible marker cannot hide an invalid price on a possible live entry.
 * @param entry - A possible live or marker root entry.
 */
function checkPossibleRootMarker(entry: ResourceEntry<DeveloperProductEntry>) {
	const config = {
		environments: { production: { products: { gems: { isManagedPricingEnabled: true } } } },
		products: { gems: entry },
	} as const;
	// @ts-expect-error -- a live root in this union may lack a price
	defineConfig(config);
}

function checkPossibleOverlayMarker(entry: ResourceEntry<{ isManagedPricingEnabled: true }>) {
	const config = {
		environments: { production: { products: { gems: entry } } },
		products: { gems: ENTRY },
	} as const;
	// @ts-expect-error -- a live overlay in this union still requires a price
	defineConfig(config);
}

describe("pricing with possible markers", () => {
	it("should retain the live price requirement in root and overlay unions", () => {
		expectTypeOf(checkPossibleRootMarker).toBeFunction();
		expectTypeOf(checkPossibleOverlayMarker).toBeFunction();
	});
});
