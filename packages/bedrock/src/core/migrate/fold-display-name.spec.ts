import { assert, describe, expect, it } from "vitest";

import { foldDisplayName } from "./fold-display-name.ts";
import type { MantleResource } from "./types.ts";

function place(key: string, inputs: unknown): MantleResource {
	return {
		key,
		dependencies: [],
		inputs,
		kind: "place",
		outputs: { assetId: 17613681043 },
	};
}

function placeConfiguration(key: string, inputs: unknown): MantleResource {
	return {
		key,
		dependencies: [],
		inputs,
		kind: "placeConfiguration",
		outputs: undefined,
	};
}

describe(foldDisplayName, () => {
	it("should resolve duplicate start-key placeConfiguration records via last-wins", () => {
		expect.assertions(1);

		const result = foldDisplayName([
			place("start", { isStart: true }),
			placeConfiguration("start", { name: "Earlier" }),
			placeConfiguration("start", { name: "Later" }),
		]);

		assert(result.entryFragment.displayName === "Later");

		expect(result.entryFragment.displayName).toBe("Later");
	});

	it("should ignore non-placeConfiguration resources and other-keyed placeConfigurations when picking the start name", () => {
		expect.assertions(1);

		const result = foldDisplayName([
			placeConfiguration("start", { name: "Start" }),
			place("start", { isStart: true }),
			placeConfiguration("lobby", { name: "Lobby" }),
			place("lobby", { isStart: false }),
		]);

		expect(result.entryFragment.displayName).toBe("Start");
	});
});
