import { assert, describe, expect, it } from "vitest";

import { foldPlaces } from "./fold-places.ts";
import type { MantleResource } from "./types.ts";

const VALID_HASH = "908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9";

interface PlaceArgs {
	readonly key: string;
	readonly inputs?: unknown;
	readonly outputs: unknown;
}

interface PlaceFileArgs {
	readonly key: string;
	readonly inputs: unknown;
	readonly outputs: unknown;
}

function place({ key, inputs = { isStart: false }, outputs }: PlaceArgs): MantleResource {
	return {
		key,
		dependencies: [],
		inputs,
		kind: "place",
		outputs,
	};
}

function placeFile({ key, inputs, outputs }: PlaceFileArgs): MantleResource {
	return {
		key,
		dependencies: [],
		inputs,
		kind: "placeFile",
		outputs,
	};
}

function defaultPlaceFile(key: string): MantleResource {
	return placeFile({
		key,
		inputs: { fileHash: VALID_HASH, filePath: "place.rbxl" },
		outputs: { version: 53 },
	});
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

describe(foldPlaces, () => {
	it("should fold a matched place and placeFile pair into one entry", () => {
		expect.assertions(2);

		const result = foldPlaces([
			place({ key: "start", outputs: { assetId: 17613681043 } }),
			defaultPlaceFile("start"),
		]);

		const entry = result.entries.get("start");
		assert(entry !== undefined);

		expect(entry.entry).toStrictEqual({ filePath: "place.rbxl" });
		expect(entry.placeId).toBe("17613681043");
	});

	it("should accept a string-formatted place assetId", () => {
		expect.assertions(1);

		const result = foldPlaces([
			place({ key: "start", outputs: { assetId: "17613681043" } }),
			defaultPlaceFile("start"),
		]);

		const entry = result.entries.get("start");
		assert(entry !== undefined);

		expect(entry.placeId).toBe("17613681043");
	});

	it("should record the placeFile version number in outputs", () => {
		expect.assertions(1);

		const result = foldPlaces([
			place({ key: "start", outputs: { assetId: 17613681043 } }),
			defaultPlaceFile("start"),
		]);

		const entry = result.entries.get("start");
		assert(entry !== undefined);

		expect(entry.outputs).toStrictEqual({ versionNumber: 53 });
	});

	it("should propagate the Mantle-recorded fileHash on the matched entry", () => {
		expect.assertions(1);

		const result = foldPlaces([
			place({ key: "start", outputs: { assetId: 17613681043 } }),
			defaultPlaceFile("start"),
		]);

		const entry = result.entries.get("start");
		assert(entry !== undefined);

		expect(entry.fileHash).toBe(VALID_HASH);
	});

	it("should emit no warnings when every place has a matching placeFile", () => {
		expect.assertions(1);

		const result = foldPlaces([
			place({ key: "start", outputs: { assetId: 17613681043 } }),
			defaultPlaceFile("start"),
		]);

		expect(result.warnings).toStrictEqual([]);
	});

	it("should ignore non-place and non-placeFile resources", () => {
		expect.assertions(2);

		const result = foldPlaces([
			{
				key: "singleton",
				dependencies: [],
				inputs: { groupId: undefined },
				kind: "experience",
				outputs: { assetId: 6031475575, startPlaceId: 17613681043 },
			},
			place({ key: "start", outputs: { assetId: 17613681043 } }),
			defaultPlaceFile("start"),
		]);

		expect([...result.entries.keys()]).toStrictEqual(["start"]);
		expect(result.warnings).toStrictEqual([]);
	});

	it("should return an empty entries map when no place resources are present", () => {
		expect.assertions(2);

		const result = foldPlaces([]);

		expect(result.entries.size).toBe(0);
		expect(result.warnings).toStrictEqual([]);
	});

	it("should emit an ambiguous warning when a place has no matching placeFile", () => {
		expect.assertions(4);

		const result = foldPlaces([place({ key: "orphan", outputs: { assetId: 17613681043 } })]);

		expect(result.entries.size).toBe(0);
		expect(result.warnings).toHaveLength(1);

		const [warning] = result.warnings;
		assert(warning?.kind === "ambiguous");

		expect(warning.mantlePath).toBe("place_orphan");
		expect(warning.hint).toMatch(/verify your mantle state/i);
	});

	it("should emit an ambiguous warning when a placeFile has no matching place", () => {
		expect.assertions(3);

		const result = foldPlaces([
			placeFile({
				key: "orphan",
				inputs: { fileHash: VALID_HASH, filePath: "place.rbxl" },
				outputs: { version: 1 },
			}),
		]);

		expect(result.entries.size).toBe(0);
		expect(result.warnings).toHaveLength(1);

		const [warning] = result.warnings;
		assert(warning?.kind === "ambiguous");

		expect(warning.mantlePath).toBe("placeFile_orphan");
	});

	it("should pair only the matched key when one of two places lacks a placeFile", () => {
		expect.assertions(3);

		const result = foldPlaces([
			place({ key: "start", outputs: { assetId: 1 } }),
			place({ key: "lobby", outputs: { assetId: 2 } }),
			defaultPlaceFile("start"),
		]);

		expect([...result.entries.keys()]).toStrictEqual(["start"]);
		expect(result.warnings).toHaveLength(1);

		const [warning] = result.warnings;
		assert(warning?.kind === "ambiguous");

		expect(warning.mantlePath).toBe("place_lobby");
	});

	it("should not produce an entry when place outputs declares a non-integer assetId", () => {
		expect.assertions(2);

		const result = foldPlaces([
			place({ key: "start", outputs: { assetId: 1.5 } }),
			defaultPlaceFile("start"),
		]);

		expect(result.entries.size).toBe(0);
		expect(result.warnings).toStrictEqual([]);
	});

	it("should not produce an entry when place outputs is undefined", () => {
		expect.assertions(2);

		const result = foldPlaces([
			place({ key: "start", outputs: undefined }),
			defaultPlaceFile("start"),
		]);

		expect(result.entries.size).toBe(0);
		expect(result.warnings).toStrictEqual([]);
	});

	it("should not produce an entry when placeFile inputs carries a malformed fileHash", () => {
		expect.assertions(2);

		const result = foldPlaces([
			place({ key: "start", outputs: { assetId: 17613681043 } }),
			placeFile({
				key: "start",
				inputs: { fileHash: "abc", filePath: "place.rbxl" },
				outputs: { version: 53 },
			}),
		]);

		expect(result.entries.size).toBe(0);
		expect(result.warnings).toStrictEqual([]);
	});

	it("should not produce an entry when place outputs is null", () => {
		expect.assertions(2);

		const result = foldPlaces([
			// eslint-disable-next-line unicorn/no-null -- exercising the null guard against direct callers that bypass parseState's null normalization
			place({ key: "start", outputs: null }),
			defaultPlaceFile("start"),
		]);

		expect(result.entries.size).toBe(0);
		expect(result.warnings).toStrictEqual([]);
	});

	it("should fold multiple matched place pairs in one environment", () => {
		expect.assertions(4);

		const result = foldPlaces([
			place({ key: "start", outputs: { assetId: 17613681043 } }),
			place({ key: "lobby", outputs: { assetId: 17613681044 } }),
			placeFile({
				key: "start",
				inputs: { fileHash: VALID_HASH, filePath: "start.rbxl" },
				outputs: { version: 53 },
			}),
			placeFile({
				key: "lobby",
				inputs: { fileHash: VALID_HASH, filePath: "lobby.rbxl" },
				outputs: { version: 7 },
			}),
		]);

		expect(result.entries.size).toBe(2);

		const start = result.entries.get("start");
		const lobby = result.entries.get("lobby");
		assert(start !== undefined);
		assert(lobby !== undefined);

		expect(start.placeId).toBe("17613681043");
		expect(lobby.placeId).toBe("17613681044");
		expect(lobby.entry).toStrictEqual({ filePath: "lobby.rbxl" });
	});

	describe("placeConfiguration.description fold", () => {
		it("should fold description onto the matched entry", () => {
			expect.assertions(1);

			const result = foldPlaces([
				place({ key: "start", outputs: { assetId: 17613681043 } }),
				defaultPlaceFile("start"),
				placeConfiguration("start", { description: "A project template" }),
			]);

			const entry = result.entries.get("start");
			assert(entry !== undefined);

			expect(entry.entry.description).toBe("A project template");
		});

		it("should emit one interpretive warning for the description fold", () => {
			expect.assertions(1);

			const result = foldPlaces([
				place({ key: "start", outputs: { assetId: 17613681043 } }),
				defaultPlaceFile("start"),
				placeConfiguration("start", { description: "A project template" }),
			]);

			expect(result.warnings).toStrictEqual([
				{
					bedrockPath: "places.start.description",
					kind: "interpretive",
					mantlePath: "placeConfiguration_start.description",
					rule: "place-description",
				},
			]);
		});

		it("should silently skip a non-string description", () => {
			expect.assertions(2);

			const result = foldPlaces([
				place({ key: "start", outputs: { assetId: 17613681043 } }),
				defaultPlaceFile("start"),
				placeConfiguration("start", { description: 42 }),
			]);

			const entry = result.entries.get("start");
			assert(entry !== undefined);

			expect(entry.entry.description).toBeNil();
			expect(result.warnings).toStrictEqual([]);
		});

		it("should not synthesize an entry for an unmatched placeConfiguration", () => {
			expect.assertions(2);

			const result = foldPlaces([placeConfiguration("orphan", { description: "Stranded" })]);

			expect(result.entries.size).toBe(0);
			expect(result.warnings).toStrictEqual([]);
		});
	});

	describe("placeConfiguration.maxPlayerCount fold", () => {
		it("should fold maxPlayerCount onto entry.serverSize", () => {
			expect.assertions(1);

			const result = foldPlaces([
				place({ key: "start", outputs: { assetId: 17613681043 } }),
				defaultPlaceFile("start"),
				placeConfiguration("start", { maxPlayerCount: 700 }),
			]);

			const entry = result.entries.get("start");
			assert(entry !== undefined);

			expect(entry.entry.serverSize).toBe(700);
		});

		it("should emit one interpretive warning for the serverSize rename", () => {
			expect.assertions(1);

			const result = foldPlaces([
				place({ key: "start", outputs: { assetId: 17613681043 } }),
				defaultPlaceFile("start"),
				placeConfiguration("start", { maxPlayerCount: 700 }),
			]);

			expect(result.warnings).toStrictEqual([
				{
					bedrockPath: "places.start.serverSize",
					kind: "interpretive",
					mantlePath: "placeConfiguration_start.maxPlayerCount",
					rule: "max-player-count-to-server-size",
				},
			]);
		});

		it.for<[label: string, value: unknown]>([
			["zero", 0],
			["negative", -3],
			["fractional", 1.5],
			["string", "700"],
		])("should silently skip a %s maxPlayerCount", ([, value]) => {
			expect.assertions(2);

			const result = foldPlaces([
				place({ key: "start", outputs: { assetId: 17613681043 } }),
				defaultPlaceFile("start"),
				placeConfiguration("start", { maxPlayerCount: value }),
			]);

			const entry = result.entries.get("start");
			assert(entry !== undefined);

			expect(entry.entry.serverSize).toBeNil();
			expect(result.warnings).toStrictEqual([]);
		});
	});

	describe("blocked placeConfiguration fields", () => {
		it.for<[label: string, field: string, value: unknown, reason: string]>([
			[
				"allowCopying",
				"allowCopying",
				true,
				"placeConfiguration.allowCopying has no Open Cloud equivalent",
			],
			[
				"socialSlotType",
				"socialSlotType",
				"Automatic",
				"placeConfiguration social-slot config has no Open Cloud equivalent",
			],
			[
				"customSocialSlotsCount",
				"customSocialSlotsCount",
				4,
				"placeConfiguration social-slot config has no Open Cloud equivalent",
			],
		])("should emit a blocked warning when %s is set", ([, field, value, reason]) => {
			expect.assertions(1);

			const result = foldPlaces([placeConfiguration("start", { [field]: value })]);

			expect(result.warnings).toStrictEqual([
				{
					kind: "blocked",
					mantlePath: `placeConfiguration_start.${field}`,
					reason,
				},
			]);
		});

		it("should emit no warning for a tracked field whose value is undefined", () => {
			expect.assertions(1);

			const result = foldPlaces([
				placeConfiguration("start", {
					allowCopying: undefined,
					description: undefined,
				}),
			]);

			expect(result.warnings).toStrictEqual([]);
		});

		it("should emit one warning per tracked field per placeConfiguration resource", () => {
			expect.assertions(1);

			const result = foldPlaces([
				placeConfiguration("start", {
					allowCopying: true,
					customSocialSlotsCount: 4,
				}),
				placeConfiguration("lobby", { socialSlotType: "Empty" }),
			]);

			expect(result.warnings).toIncludeAllPartialMembers([
				{ kind: "blocked", mantlePath: "placeConfiguration_start.allowCopying" },
				{ kind: "blocked", mantlePath: "placeConfiguration_start.customSocialSlotsCount" },
				{ kind: "blocked", mantlePath: "placeConfiguration_lobby.socialSlotType" },
			]);
		});

		it("should emit no blocked warning when no placeConfiguration resource is present", () => {
			expect.assertions(1);

			const result = foldPlaces([
				place({ key: "start", outputs: { assetId: 17613681043 } }),
				defaultPlaceFile("start"),
			]);

			expect(result.warnings).toStrictEqual([]);
		});

		it("should skip a placeConfiguration whose inputs is not an object", () => {
			expect.assertions(1);

			const result = foldPlaces([placeConfiguration("start", "not-an-object")]);

			expect(result.warnings).toStrictEqual([]);
		});

		it("should not emit a blocked warning for the name field (foldDisplayName owns it)", () => {
			expect.assertions(1);

			const result = foldPlaces([placeConfiguration("start", { name: "My Place" })]);

			expect(
				result.warnings.filter((warning) => {
					return (
						warning.kind === "blocked" &&
						warning.mantlePath === "placeConfiguration_start.name"
					);
				}),
			).toStrictEqual([]);
		});
	});
});
