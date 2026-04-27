import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import { UNIVERSE_SINGLETON_KEY } from "../resources.ts";
import { buildState } from "./build-state.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";

const VALID_HASH = asSha256Hex("908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9");

const FOLDED_UNIVERSE: EnvironmentFoldResult = {
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

describe(buildState, () => {
	it("should set the schema version literal to 1", () => {
		expect.assertions(1);

		const state = buildState("production", FOLDED_UNIVERSE);

		expect(state.version).toBe(1);
	});

	it("should record the environment name verbatim", () => {
		expect.assertions(1);

		const state = buildState("staging", FOLDED_UNIVERSE);

		expect(state.environment).toBe("staging");
	});

	it("should emit one universe ResourceCurrentState when the fold yielded a universe", () => {
		expect.assertions(4);

		const state = buildState("production", FOLDED_UNIVERSE);

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

		const state = buildState("production", FOLDED_UNIVERSE);

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(resource.outputs.rootPlaceId).toBe("17613681043");
	});

	it("should leave universe-managed device flags as undefined when the entry omits them", () => {
		expect.assertions(5);

		const state = buildState("production", FOLDED_UNIVERSE);

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

		const state = buildState("production", FOLDED_UNIVERSE);

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "universe");

		expect(resource.voiceChatEnabled).toBeUndefined();
		expect(resource.visibility).toBeUndefined();
	});

	it("should emit an empty resources array when the fold yielded no universe", () => {
		expect.assertions(1);

		const state = buildState("production", {
			places: new Map(),
			universe: undefined,
			warnings: [],
		});

		expect(state.resources).toStrictEqual([]);
	});

	it("should emit one place ResourceCurrentState per folded place entry", () => {
		expect.assertions(5);

		const state = buildState("production", {
			places: new Map([["start", placeFold()]]),
			universe: undefined,
			warnings: [],
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

		const state = buildState("production", {
			places: new Map([["start", placeFold()]]),
			universe: undefined,
			warnings: [],
		});

		const [resource] = state.resources;
		assert(resource !== undefined);
		assert(resource.kind === "place");

		expect(resource.fileHash).toBe(VALID_HASH);
	});

	it("should emit place resources after the universe resource", () => {
		expect.assertions(2);

		const state = buildState("production", {
			places: new Map([["start", placeFold()]]),
			universe: FOLDED_UNIVERSE.universe,
			warnings: [],
		});

		expect(state.resources).toHaveLength(2);
		expect(state.resources.map((resource) => resource.kind)).toStrictEqual([
			"universe",
			"place",
		]);
	});
});
