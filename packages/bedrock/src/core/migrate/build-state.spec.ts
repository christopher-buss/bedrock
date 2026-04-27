import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId } from "../../types/ids.ts";
import { UNIVERSE_SINGLETON_KEY } from "../resources.ts";
import { buildState } from "./build-state.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";

const FOLDED_UNIVERSE: EnvironmentFoldResult = {
	universe: {
		entry: { universeId: "6031475575" },
		outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
	},
	warnings: [],
};

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

		const state = buildState("production", { universe: undefined, warnings: [] });

		expect(state.resources).toStrictEqual([]);
	});
});
