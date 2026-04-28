import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import type { ResourceKey, Sha256Hex } from "../../types/ids.ts";
import { UNIVERSE_SINGLETON_KEY } from "../resources.ts";
import { buildState } from "./build-state.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PassFoldEntry } from "./fold-passes.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";

const SAMPLE_HASH = asSha256Hex("86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1");
const VALID_HASH = asSha256Hex("908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9");
const RECOMPUTED_HASH = asSha256Hex(
	"a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
);

const NO_HASHES: ReadonlyMap<ResourceKey, Sha256Hex> = new Map();

const FOLDED_UNIVERSE: EnvironmentFoldResult = {
	passes: [],
	places: new Map(),
	universe: {
		entry: { universeId: "6031475575" },
		outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
	},
	warnings: [],
};

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
			iconFilePath: "assets/marketing/example-icon.png",
			price: 5,
		},
		mantleIconFileHash: SAMPLE_HASH,
		mantlePath: `pass_${key}`,
		outputs: {
			assetId: asRobloxAssetId("838509486"),
			iconAssetId: asRobloxAssetId("18109205439"),
		},
	};
}

describe(buildState, () => {
	it("should set the schema version literal to 1", () => {
		expect.assertions(1);

		const state = buildState({
			environment: "production",
			folded: FOLDED_UNIVERSE,
			iconHashesByKey: NO_HASHES,
		});

		expect(state.version).toBe(1);
	});

	it("should record the environment name verbatim", () => {
		expect.assertions(1);

		const state = buildState({
			environment: "staging",
			folded: FOLDED_UNIVERSE,
			iconHashesByKey: NO_HASHES,
		});

		expect(state.environment).toBe("staging");
	});

	it("should emit one universe ResourceCurrentState when the fold yielded a universe", () => {
		expect.assertions(4);

		const state = buildState({
			environment: "production",
			folded: FOLDED_UNIVERSE,
			iconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toHaveLength(1);

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(resource.kind).toBe("universe");
		expect(resource.key).toBe(UNIVERSE_SINGLETON_KEY);
		expect(resource.universeId).toBe("6031475575");
	});

	it("should expose rootPlaceId on the universe resource outputs", () => {
		expect.assertions(1);

		const state = buildState({
			environment: "production",
			folded: FOLDED_UNIVERSE,
			iconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(resource.outputs.rootPlaceId).toBe("17613681043");
	});

	it("should leave universe-managed device flags as undefined when the entry omits them", () => {
		expect.assertions(5);

		const state = buildState({
			environment: "production",
			folded: FOLDED_UNIVERSE,
			iconHashesByKey: NO_HASHES,
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

	it("should leave voice chat and visibility undefined when the entry omits them", () => {
		expect.assertions(2);

		const state = buildState({
			environment: "production",
			folded: FOLDED_UNIVERSE,
			iconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(resource.voiceChatEnabled).toBeUndefined();
		expect(resource.visibility).toBeUndefined();
	});

	it("should emit an empty resources array when the fold yielded no universe", () => {
		expect.assertions(1);

		const state = buildState({
			environment: "production",
			folded: { passes: [], places: new Map(), universe: undefined, warnings: [] },
			iconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toStrictEqual([]);
	});

	it("should emit one place ResourceCurrentState per folded place entry", () => {
		expect.assertions(5);

		const state = buildState({
			environment: "production",
			folded: {
				passes: [],
				places: new Map([["start", placeFold()]]),
				universe: undefined,
				warnings: [],
			},
			iconHashesByKey: NO_HASHES,
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

	it("should preserve the Mantle-recorded fileHash on the place resource", () => {
		expect.assertions(1);

		const state = buildState({
			environment: "production",
			folded: {
				passes: [],
				places: new Map([["start", placeFold()]]),
				universe: undefined,
				warnings: [],
			},
			iconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "place");

		expect(resource.fileHash).toBe(VALID_HASH);
	});

	it("should emit place resources after the universe resource", () => {
		expect.assertions(2);

		const state = buildState({
			environment: "production",
			folded: {
				passes: [],
				places: new Map([["start", placeFold()]]),
				universe: FOLDED_UNIVERSE.universe,
				warnings: [],
			},
			iconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toHaveLength(2);
		expect(state.resources.map((resource) => resource.kind)).toStrictEqual([
			"universe",
			"place",
		]);
	});

	it("should emit a gamePass ResourceCurrentState per folded pass entry", () => {
		expect.assertions(5);

		const folded: EnvironmentFoldResult = {
			passes: [passEntry("1-example")],
			places: new Map(),
			universe: undefined,
			warnings: [],
		};
		const hashes = new Map<ResourceKey, Sha256Hex>([
			[asResourceKey("1-example"), RECOMPUTED_HASH],
		]);

		const state = buildState({
			environment: "production",
			folded,
			iconHashesByKey: hashes,
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "gamePass");

		expect(resource.kind).toBe("gamePass");
		expect(resource.key).toBe(asResourceKey("1-example"));
		expect(resource.iconFileHash).toBe(RECOMPUTED_HASH);
		expect(resource.outputs).toStrictEqual({
			assetId: asRobloxAssetId("838509486"),
			iconAssetId: asRobloxAssetId("18109205439"),
		});
		expect(resource.price).toBe(5);
	});

	it("should fall back to the Mantle-recorded hash when iconHashesByKey omits a pass key", () => {
		expect.assertions(1);

		const folded: EnvironmentFoldResult = {
			passes: [passEntry("1-example")],
			places: new Map(),
			universe: undefined,
			warnings: [],
		};

		const state = buildState({
			environment: "production",
			folded,
			iconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource?.kind === "gamePass");

		expect(resource.iconFileHash).toBe(SAMPLE_HASH);
	});

	it("should preserve the universe resource alongside emitted gamePass resources", () => {
		expect.assertions(3);

		const folded: EnvironmentFoldResult = {
			passes: [passEntry("1-example")],
			places: new Map(),
			universe: FOLDED_UNIVERSE.universe,
			warnings: [],
		};

		const state = buildState({
			environment: "production",
			folded,
			iconHashesByKey: NO_HASHES,
		});

		expect(state.resources).toHaveLength(2);
		expect(state.resources[0]?.kind).toBe("universe");
		expect(state.resources[1]?.kind).toBe("gamePass");
	});

	it("should set price to undefined on the gamePass resource when the fold entry omits it", () => {
		expect.assertions(1);

		const offSale = passEntry("1-example");
		const offSaleEntry: PassFoldEntry = {
			...offSale,
			entry: {
				name: offSale.entry.name,
				description: offSale.entry.description,
				iconFilePath: offSale.entry.iconFilePath,
			},
		};
		const folded: EnvironmentFoldResult = {
			passes: [offSaleEntry],
			places: new Map(),
			universe: undefined,
			warnings: [],
		};

		const state = buildState({
			environment: "production",
			folded,
			iconHashesByKey: NO_HASHES,
		});

		const [resource] = state.resources;
		assert(resource?.kind === "gamePass");

		expect(resource.price).toBeUndefined();
	});
});
