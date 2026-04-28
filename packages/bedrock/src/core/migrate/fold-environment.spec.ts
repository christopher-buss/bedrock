import { assert, describe, expect, it } from "vitest";

import { asResourceKey } from "../../types/ids.ts";
import { foldEnvironment } from "./fold-environment.ts";
import type { MantleResource } from "./types.ts";

const VALID_HASH = "908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9";
const SAMPLE_HASH = "86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1";

function experience(): MantleResource {
	return {
		key: "singleton",
		dependencies: [],
		inputs: { groupId: undefined },
		kind: "experience",
		outputs: { assetId: 6031475575, startPlaceId: 17613681043 },
	};
}

function place(): MantleResource {
	return {
		key: "start",
		dependencies: [],
		inputs: { isStart: true },
		kind: "place",
		outputs: { assetId: 17613681043 },
	};
}

function placeFile(): MantleResource {
	return {
		key: "start",
		dependencies: [],
		inputs: { fileHash: VALID_HASH, filePath: "place.rbxl" },
		kind: "placeFile",
		outputs: { version: 53 },
	};
}

function pass(key: string): MantleResource {
	return {
		key,
		dependencies: [],
		inputs: {
			name: "Example Pass",
			description: "This is an example pass.",
			iconFileHash: SAMPLE_HASH,
			iconFilePath: "assets/marketing/example-icon.png",
			price: 5,
		},
		kind: "pass",
		outputs: { assetId: 838509486, iconAssetId: 18109205439 },
	};
}

describe(foldEnvironment, () => {
	it("should expose the folded universe entry when an experience is present", () => {
		expect.assertions(1);

		const result = foldEnvironment([experience()]);

		assert(result.universe !== undefined);

		expect(result.universe.entry).toStrictEqual({ universeId: "6031475575" });
	});

	it("should expose the folded universe outputs when an experience is present", () => {
		expect.assertions(1);

		const result = foldEnvironment([experience()]);

		assert(result.universe !== undefined);

		expect(result.universe.outputs).toStrictEqual({ rootPlaceId: "17613681043" });
	});

	it("should leave universe undefined when no experience resource is present", () => {
		expect.assertions(1);

		const result = foldEnvironment([]);

		expect(result.universe).toBeUndefined();
	});

	it("should aggregate an empty warnings list in the skeleton", () => {
		expect.assertions(1);

		const result = foldEnvironment([experience()]);

		expect(result.warnings).toStrictEqual([]);
	});

	it("should produce empty warnings even when no experience is present", () => {
		expect.assertions(1);

		const result = foldEnvironment([]);

		expect(result.warnings).toStrictEqual([]);
	});

	it("should expose folded place entries when a matched place pair is present", () => {
		expect.assertions(2);

		const result = foldEnvironment([experience(), place(), placeFile()]);

		const start = result.places.get("start");
		assert(start !== undefined);

		expect(start.entry).toStrictEqual({ filePath: "place.rbxl" });
		expect(start.placeId).toBe("17613681043");
	});

	it("should expose an empty places map when no place resources are present", () => {
		expect.assertions(1);

		const result = foldEnvironment([experience()]);

		expect(result.places.size).toBe(0);
	});

	it("should aggregate place ambiguous warnings into the warnings list", () => {
		expect.assertions(2);

		const result = foldEnvironment([experience(), place()]);

		expect(result.warnings).toHaveLength(1);

		const [warning] = result.warnings;
		assert(warning?.kind === "ambiguous");

		expect(warning.mantlePath).toBe("place_start");
	});

	it("should expose folded passes when pass resources are present", () => {
		expect.assertions(1);

		const result = foldEnvironment([experience(), pass("1-example")]);

		expect(result.passes.map((entry) => entry.key)).toStrictEqual([asResourceKey("1-example")]);
	});

	it("should expose an empty passes array when no pass resources are present", () => {
		expect.assertions(1);

		const result = foldEnvironment([experience()]);

		expect(result.passes).toStrictEqual([]);
	});
});
