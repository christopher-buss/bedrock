import { assert, describe, expect, it } from "vitest";

import { foldUniverse } from "./fold-universe.ts";
import type { MantleResource } from "./types.ts";

function experience(outputs: unknown): MantleResource {
	return {
		key: "singleton",
		dependencies: [],
		inputs: { groupId: undefined },
		kind: "experience",
		outputs,
	};
}

describe(foldUniverse, () => {
	it("should map experience.outputs.assetId to universe.universeId", () => {
		expect.assertions(1);

		const result = foldUniverse([
			experience({ assetId: 6031475575, startPlaceId: 17613681043 }),
		]);

		assert(result !== undefined);

		expect(result.entry).toStrictEqual({ universeId: "6031475575" });
	});

	it("should map experience.outputs.startPlaceId to outputs.rootPlaceId", () => {
		expect.assertions(1);

		const result = foldUniverse([
			experience({ assetId: 6031475575, startPlaceId: 17613681043 }),
		]);

		assert(result !== undefined);

		expect(result.outputs).toStrictEqual({ rootPlaceId: "17613681043" });
	});

	it("should accept string-formatted ids in experience outputs", () => {
		expect.assertions(2);

		const result = foldUniverse([
			experience({ assetId: "6031475575", startPlaceId: "17613681043" }),
		]);

		assert(result !== undefined);

		expect(result.entry.universeId).toBe("6031475575");
		expect(result.outputs.rootPlaceId).toBe("17613681043");
	});

	it("should emit no warnings in the skeleton", () => {
		expect.assertions(1);

		const result = foldUniverse([
			experience({ assetId: 6031475575, startPlaceId: 17613681043 }),
		]);

		assert(result !== undefined);

		expect(result.warnings).toStrictEqual([]);
	});

	it("should ignore other Mantle kinds and only consume experience", () => {
		expect.assertions(1);

		const result = foldUniverse([
			{
				key: "singleton",
				dependencies: [],
				inputs: { enabled: true },
				kind: "spatialVoice",
				outputs: undefined,
			},
			experience({ assetId: 1, startPlaceId: 2 }),
		]);

		assert(result !== undefined);

		expect(result.entry).toStrictEqual({ universeId: "1" });
	});

	it("should return undefined when no experience resource is present", () => {
		expect.assertions(1);

		const result = foldUniverse([
			{
				key: "singleton",
				dependencies: [],
				inputs: { enabled: true },
				kind: "spatialVoice",
				outputs: undefined,
			},
		]);

		expect(result).toBeUndefined();
	});

	it("should return undefined when experience outputs is not an object", () => {
		expect.assertions(1);

		const result = foldUniverse([experience(undefined)]);

		expect(result).toBeUndefined();
	});

	it("should return undefined when experience outputs is null", () => {
		expect.assertions(1);

		// eslint-disable-next-line unicorn/no-null -- exercising the null branch of the defensive guard
		const result = foldUniverse([experience(null)]);

		expect(result).toBeUndefined();
	});

	it("should return undefined when experience outputs is an array", () => {
		expect.assertions(1);

		const result = foldUniverse([experience([])]);

		expect(result).toBeUndefined();
	});

	it("should return undefined when experience outputs lacks assetId or startPlaceId", () => {
		expect.assertions(2);

		expect(foldUniverse([experience({ startPlaceId: 1 })])).toBeUndefined();
		expect(foldUniverse([experience({ assetId: 1 })])).toBeUndefined();
	});

	it("should return undefined when experience outputs has non-integer ids", () => {
		expect.assertions(2);

		expect(foldUniverse([experience({ assetId: 1.5, startPlaceId: 2 })])).toBeUndefined();
		expect(
			foldUniverse([experience({ assetId: { nested: 1 }, startPlaceId: 2 })]),
		).toBeUndefined();
	});
});
