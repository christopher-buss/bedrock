import { assert, describe, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import type { ResourceKey, Sha256Hex } from "../../types/ids.ts";
import { UNIVERSE_SINGLETON_KEY } from "../resources.ts";
import { buildState } from "./build-state.ts";
import type { BadgeFoldEntry } from "./fold-badges.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PassFoldEntry } from "./fold-passes.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";
import type { ProductFoldEntry } from "./fold-products.ts";

const SAMPLE_HASH = asSha256Hex("86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1");
const VALID_HASH = asSha256Hex("908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9");
const RECOMPUTED_HASH = asSha256Hex(
	"a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
);
const PRODUCT_MANTLE_HASH = asSha256Hex(
	"d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2",
);
const PRODUCT_RECOMPUTED_HASH = asSha256Hex(
	"e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3",
);

const NO_HASHES: ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>> = new Map();

const FOLDED_UNIVERSE = {
	badges: [],
	passes: [],
	places: new Map(),
	products: [],
	universe: {
		entry: { universeId: "6031475575" },
		outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
	},
	warnings: [],
} satisfies EnvironmentFoldResult;

function badgeEntry(key: string, withMantleHash: boolean): BadgeFoldEntry {
	const base: BadgeFoldEntry = {
		key: asResourceKey(key),
		entry: {
			name: "Welcome",
			description: "Hello.",
			enabled: false,
			icon: { "en-us": "assets/badge.png" },
		},
		mantlePath: `badge_${key}`,
		outputs: {
			badgeId: asRobloxAssetId("3630460038655754"),
			iconImageId: asRobloxAssetId("17622418492"),
		},
	};
	return withMantleHash ? { ...base, mantleIconFileHashes: { "en-us": SAMPLE_HASH } } : base;
}

function buildBadgeState(
	entry: BadgeFoldEntry,
	badgeIconHashesByKey: ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>> = NO_HASHES,
): ReturnType<typeof buildState> {
	return buildState({
		badgeIconHashesByKey,
		environment: "production",
		folded: { ...FOLDED_UNIVERSE, badges: [entry], universe: undefined },
		passIconHashesByKey: NO_HASHES,
		productIconHashesByKey: NO_HASHES,
	});
}

function placeFold(overrides: Partial<PlaceFoldEntry> = {}): PlaceFoldEntry {
	return {
		entry: { filePath: "place.rbxl" },
		fileHash: VALID_HASH,
		outputs: { versionNumber: 53 },
		placeId: "17613681043",
		...overrides,
	};
}

function passEntry(key: string): PassFoldEntry {
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
	};
}

function productEntryWithIcon(key: string): ProductFoldEntry {
	return {
		key: asResourceKey(key),
		entry: {
			name: "Gem Pack",
			description: "Stocks the player up with 1,000 premium gems.",
			icon: { "en-us": "assets/marketing/gem-pack.png" },
			price: 100,
		},
		mantleIconFileHashes: { "en-us": PRODUCT_MANTLE_HASH },
		mantlePath: `product_${key}`,
		outputs: {
			iconImageAssetId: asRobloxAssetId("99887766"),
			productId: asRobloxAssetId("12345678"),
		},
	};
}

function productEntryWithoutIcon(key: string): ProductFoldEntry {
	return {
		key: asResourceKey(key),
		entry: {
			name: "Coin Pack",
			description: "Adds 500 coins to the player's wallet.",
			price: 50,
		},
		mantlePath: `product_${key}`,
		outputs: {
			iconImageAssetId: undefined,
			productId: asRobloxAssetId("87654321"),
		},
	};
}

describe(buildState, () => {
	it.for(["public", "private"] as const)(
		"should retain the migrated %s visibility in Current state",
		(visibility, { expect }) => {
			expect.assertions(1);

			const state = buildState({
				badgeIconHashesByKey: NO_HASHES,
				environment: "production",
				folded: {
					...FOLDED_UNIVERSE,
					universe: {
						...FOLDED_UNIVERSE.universe,
						entry: { universeId: "6031475575", visibility },
					},
				},
				passIconHashesByKey: NO_HASHES,
				productIconHashesByKey: NO_HASHES,
			});

			expect(state.resources[0]).toHaveProperty("visibility", visibility);
		},
	);

	it("should omit visibility from migrated Current state when it was unmanaged", ({ expect }) => {
		expect.assertions(1);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: FOLDED_UNIVERSE,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.resources[0]).not.toHaveProperty("visibility");
	});

	it("should set the schema version literal to 1", ({ expect }) => {
		expect.assertions(1);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: FOLDED_UNIVERSE,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.version).toBe(1);
	});

	it("should record the environment name verbatim", ({ expect }) => {
		expect.assertions(1);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "staging",
			folded: FOLDED_UNIVERSE,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.environment).toBe("staging");
	});

	it("should emit one universe ResourceCurrentState when the fold yielded a universe", ({
		expect,
	}) => {
		expect.assertions(4);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: FOLDED_UNIVERSE,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toHaveLength(1);

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(resource.kind).toBe("universe");
		expect(resource.key).toBe(UNIVERSE_SINGLETON_KEY);
		expect(resource.universeId).toBe("6031475575");
	});

	it("should expose rootPlaceId on the universe resource outputs", ({ expect }) => {
		expect.assertions(1);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: FOLDED_UNIVERSE,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(resource.outputs.rootPlaceId).toBe("17613681043");
	});

	it("should leave universe-managed device flags as undefined when the entry omits them", ({
		expect,
	}) => {
		expect.assertions(5);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: FOLDED_UNIVERSE,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(resource.consoleEnabled).toBeUndefined();
		expect(resource.desktopEnabled).toBeUndefined();
		expect(resource.mobileEnabled).toBeUndefined();
		expect(resource.tabletEnabled).toBeUndefined();
		expect(resource.vrEnabled).toBeUndefined();
	});

	it("should leave voice chat undefined when the entry omits it", ({ expect }) => {
		expect.assertions(1);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: FOLDED_UNIVERSE,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(resource.voiceChatEnabled).toBeUndefined();
	});

	it("should emit an empty resources array when the fold yielded no universe", ({ expect }) => {
		expect.assertions(1);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: {
				badges: [],
				passes: [],
				places: new Map(),
				products: [],
				universe: undefined,
				warnings: [],
			},
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toStrictEqual([]);
	});

	it("should emit one place ResourceCurrentState per folded place entry", ({ expect }) => {
		expect.assertions(5);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: {
				badges: [],
				passes: [],
				places: new Map([["start", placeFold()]]),
				products: [],
				universe: undefined,
				warnings: [],
			},
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toHaveLength(1);

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "place");

		expect(resource.key).toBe("start");
		expect(resource.placeId).toBe("17613681043");
		expect(resource.filePath).toBe("place.rbxl");
		expect(resource.outputs.versionNumber).toBe(53);
	});

	it("should preserve the Mantle-recorded fileHash on the place resource", ({ expect }) => {
		expect.assertions(1);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: {
				badges: [],
				passes: [],
				places: new Map([["start", placeFold()]]),
				products: [],
				universe: undefined,
				warnings: [],
			},
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "place");

		expect(resource.fileHash).toBe(VALID_HASH);
	});

	it("should propagate folded description, displayName, and serverSize onto the place resource", ({
		expect,
	}) => {
		expect.assertions(3);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: {
				badges: [],
				passes: [],
				places: new Map([
					[
						"start",
						placeFold({
							entry: {
								description: "A welcoming start place",
								displayName: "Atrium",
								filePath: "place.rbxl",
								serverSize: 32,
							},
						}),
					],
				]),
				products: [],
				universe: undefined,
				warnings: [],
			},
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "place");

		expect(resource.description).toBe("A welcoming start place");
		expect(resource.displayName).toBe("Atrium");
		expect(resource.serverSize).toBe(32);
	});

	it("should leave description, displayName, and serverSize undefined when the folded entry omits them", ({
		expect,
	}) => {
		expect.assertions(3);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: {
				badges: [],
				passes: [],
				places: new Map([["start", placeFold()]]),
				products: [],
				universe: undefined,
				warnings: [],
			},
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "place");

		expect(resource.description).toBeUndefined();
		expect(resource.displayName).toBeUndefined();
		expect(resource.serverSize).toBeUndefined();
	});

	it("should emit place resources after the universe resource", ({ expect }) => {
		expect.assertions(2);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded: {
				badges: [],
				passes: [],
				places: new Map([["start", placeFold()]]),
				products: [],
				universe: FOLDED_UNIVERSE.universe,
				warnings: [],
			},
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toHaveLength(2);
		expect(state.resources.map((resource) => resource.kind)).toStrictEqual([
			"universe",
			"place",
		]);
	});

	it("should emit a gamePass ResourceCurrentState per folded pass entry", ({ expect }) => {
		expect.assertions(5);

		const folded = {
			badges: [],
			passes: [passEntry("1-example")],
			places: new Map(),
			products: [],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;
		const hashes = new Map<ResourceKey, Record<"en-us", Sha256Hex>>([
			[asResourceKey("1-example"), { "en-us": RECOMPUTED_HASH }],
		]);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: hashes,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "gamePass");

		expect(resource.kind).toBe("gamePass");
		expect(resource.key).toBe(asResourceKey("1-example"));
		expect(resource.iconFileHashes).toStrictEqual({ "en-us": RECOMPUTED_HASH });
		expect(resource.outputs).toStrictEqual({
			assetId: asRobloxAssetId("838509486"),
			iconAssetIds: { "en-us": asRobloxAssetId("18109205439") },
		});
		expect(resource.price).toBe(5);
	});

	it("should fall back to the Mantle-recorded hash when passIconHashesByKey omits a pass key", ({
		expect,
	}) => {
		expect.assertions(1);

		const folded = {
			badges: [],
			passes: [passEntry("1-example")],
			places: new Map(),
			products: [],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "gamePass");

		expect(resource.iconFileHashes).toStrictEqual({ "en-us": SAMPLE_HASH });
	});

	it("should preserve the universe resource alongside emitted gamePass resources", ({
		expect,
	}) => {
		expect.assertions(3);

		const folded = {
			badges: [],
			passes: [passEntry("1-example")],
			places: new Map(),
			products: [],
			universe: FOLDED_UNIVERSE.universe,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toHaveLength(2);
		expect(state.resources[0]!.kind).toBe("universe");
		expect(state.resources[1]!.kind).toBe("gamePass");
	});

	it("should set price to undefined on the gamePass resource when the fold entry omits it", ({
		expect,
	}) => {
		expect.assertions(1);

		const offSale = passEntry("1-example");
		const offSaleEntry = {
			...offSale,
			entry: {
				name: offSale.entry.name,
				description: offSale.entry.description,
				icon: offSale.entry.icon,
			},
		} satisfies PassFoldEntry;
		const folded = {
			badges: [],
			passes: [offSaleEntry],
			places: new Map(),
			products: [],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "gamePass");

		expect(resource.price).toBeUndefined();
	});

	it("should emit one developerProduct resource per folded product entry", ({ expect }) => {
		expect.assertions(2);

		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [productEntryWithIcon("gem-pack"), productEntryWithoutIcon("coin-pack")],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toHaveLength(2);
		expect(state.resources.map((resource) => resource.kind)).toStrictEqual([
			"developerProduct",
			"developerProduct",
		]);
	});

	it("should preserve productId on the developer-product resource outputs", ({ expect }) => {
		expect.assertions(1);

		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [productEntryWithIcon("gem-pack")],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "developerProduct");

		expect(resource.outputs.productId).toBe(asRobloxAssetId("12345678"));
	});

	it("should emit icon and iconFileHashes when the fold entry carries an icon", ({ expect }) => {
		expect.assertions(2);

		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [productEntryWithIcon("gem-pack")],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "developerProduct");

		expect(resource.icon).toStrictEqual({ "en-us": "assets/marketing/gem-pack.png" });
		expect(resource.iconFileHashes).toStrictEqual({ "en-us": PRODUCT_MANTLE_HASH });
	});

	it("should omit icon and iconFileHashes when the fold entry has no icon", ({ expect }) => {
		expect.assertions(4);

		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [productEntryWithoutIcon("coin-pack")],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "developerProduct");

		expect(resource.icon).toBeUndefined();
		expect(resource.iconFileHashes).toBeUndefined();
		expect("icon" in resource).toBeFalse();
		expect("iconFileHashes" in resource).toBeFalse();
	});

	it("should prefer recomputed icon hashes over the mantle-recorded fallback", ({ expect }) => {
		expect.assertions(1);

		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [productEntryWithIcon("gem-pack")],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;
		const productHashes = new Map<ResourceKey, Record<"en-us", Sha256Hex>>([
			[asResourceKey("gem-pack"), { "en-us": PRODUCT_RECOMPUTED_HASH }],
		]);

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: productHashes,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "developerProduct");

		expect(resource.iconFileHashes).toStrictEqual({ "en-us": PRODUCT_RECOMPUTED_HASH });
	});

	it("should fall back to mantleIconFileHashes when productIconHashesByKey omits the key", ({
		expect,
	}) => {
		expect.assertions(1);

		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [productEntryWithIcon("gem-pack")],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "developerProduct");

		expect(resource.iconFileHashes).toStrictEqual({ "en-us": PRODUCT_MANTLE_HASH });
	});

	it("should preserve iconImageAssetId on outputs when the fold entry has an icon", ({
		expect,
	}) => {
		expect.assertions(1);

		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [productEntryWithIcon("gem-pack")],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "developerProduct");

		expect(resource.outputs.iconImageAssetId).toBe(asRobloxAssetId("99887766"));
	});

	it("should leave iconImageAssetId undefined on outputs when the fold entry has no icon", ({
		expect,
	}) => {
		expect.assertions(1);

		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [productEntryWithoutIcon("coin-pack")],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "developerProduct");

		expect(resource.outputs.iconImageAssetId).toBeUndefined();
	});

	it("should omit icon when the fold entry carries an icon path but no mantle hashes", ({
		expect,
	}) => {
		expect.assertions(2);

		const malformed = productEntryWithIcon("gem-pack");
		const malformedEntry = {
			key: malformed.key,
			entry: malformed.entry,
			mantlePath: malformed.mantlePath,
			outputs: malformed.outputs,
		} satisfies ProductFoldEntry;
		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [malformedEntry],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "developerProduct");

		expect("icon" in resource).toBeFalse();
		expect("iconFileHashes" in resource).toBeFalse();
	});

	it("should omit icon when the fold entry has mantle hashes but no icon path", ({ expect }) => {
		expect.assertions(2);

		const folded = {
			badges: [],
			passes: [],
			places: new Map(),
			products: [
				{
					key: asResourceKey("coin-pack"),
					entry: {
						name: "Coin Pack",
						description: "Adds 500 coins to the player's wallet.",
						price: 50,
					},
					mantleIconFileHashes: { "en-us": PRODUCT_MANTLE_HASH },
					mantlePath: "product_coin-pack",
					outputs: {
						iconImageAssetId: undefined,
						productId: asRobloxAssetId("87654321"),
					},
				},
			],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "developerProduct");

		expect("icon" in resource).toBeFalse();
		expect("iconFileHashes" in resource).toBeFalse();
	});

	it("should emit developer-product resources after the pass resources", ({ expect }) => {
		expect.assertions(1);

		const folded = {
			badges: [],
			passes: [passEntry("1-example")],
			places: new Map(),
			products: [productEntryWithIcon("gem-pack")],
			universe: undefined,
			warnings: [],
		} satisfies EnvironmentFoldResult;

		const state = buildState({
			badgeIconHashesByKey: NO_HASHES,
			environment: "production",
			folded,
			passIconHashesByKey: NO_HASHES,
			productIconHashesByKey: NO_HASHES,
		});

		expect(state.resources.map((resource) => resource.kind)).toStrictEqual([
			"gamePass",
			"developerProduct",
		]);
	});

	it("should emit a badge resource with the recomputed icon hash and mantle outputs", ({
		expect,
	}) => {
		expect.assertions(1);

		const state = buildBadgeState(
			badgeEntry("welcome", true),
			new Map([[asResourceKey("welcome"), { "en-us": PRODUCT_RECOMPUTED_HASH }]]),
		);

		expect(state.resources).toStrictEqual([
			{
				key: asResourceKey("welcome"),
				name: "Welcome",
				description: "Hello.",
				enabled: false,
				icon: { "en-us": "assets/badge.png" },
				iconFileHashes: { "en-us": PRODUCT_RECOMPUTED_HASH },
				kind: "badge",
				outputs: {
					badgeId: asRobloxAssetId("3630460038655754"),
					iconImageId: asRobloxAssetId("17622418492"),
				},
			},
		]);
	});

	it("should fall back to the mantle badge icon hash when no recomputed hash exists", ({
		expect,
	}) => {
		expect.assertions(1);

		const [resource] = buildBadgeState(badgeEntry("welcome", true)).resources;
		assert(resource !== undefined);
		assert(resource.kind === "badge");

		expect(resource.iconFileHashes).toStrictEqual({ "en-us": SAMPLE_HASH });
	});

	it("should keep a badge with no icon hash at all under the all-zero placeholder hash", ({
		expect,
	}) => {
		expect.assertions(1);

		const [resource] = buildBadgeState(badgeEntry("welcome", false)).resources;
		assert(resource !== undefined);
		assert(resource.kind === "badge");

		expect(resource.iconFileHashes).toStrictEqual({ "en-us": "0".repeat(64) });
	});
});
