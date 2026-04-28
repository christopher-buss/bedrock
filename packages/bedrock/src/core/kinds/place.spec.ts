import { placeCurrent, placeDesired } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import { placeKind } from "./place.ts";

const ALT_HASH = asSha256Hex("a3f2c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852e1b0");

describe("placeKind", () => {
	it("should tag its kind discriminator as place", () => {
		expect.assertions(1);

		expect(placeKind.kind).toBe("place");
	});

	describe("flatten", () => {
		it("should emit a tagged input per entry in config.places with branded placeId", () => {
			expect.assertions(1);

			expect(
				placeKind.flatten({
					environments: { production: {} },
					places: {
						"start-place": {
							description: "The lobby place.",
							displayName: "Start Place",
							filePath: "places/start.rbxl",
							placeId: "4711",
							serverSize: 50,
						},
					},
				}),
			).toStrictEqual([
				{
					key: asResourceKey("start-place"),
					description: "The lobby place.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
					serverSize: 50,
				},
			]);
		});

		it("should propagate undefined for metadata fields the user did not declare", () => {
			expect.assertions(1);

			expect(
				placeKind.flatten({
					environments: { production: {} },
					places: {
						"start-place": { filePath: "places/start.rbxl", placeId: "4711" },
					},
				}),
			).toStrictEqual([
				{
					key: asResourceKey("start-place"),
					description: undefined,
					displayName: undefined,
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
					serverSize: undefined,
				},
			]);
		});

		it("should emit an empty list when the config has no places", () => {
			expect.assertions(1);

			expect(placeKind.flatten({ environments: { production: {} } })).toBeEmpty();
		});
	});

	describe("normalize", () => {
		it("should layer a sha256 hex digest of the file bytes onto the desired state", async () => {
			expect.assertions(1);

			const bytes = new Uint8Array([0x3c, 0x72, 0x6f, 0x62]);
			const result = await placeKind.normalize(
				{
					key: asResourceKey("start-place"),
					description: undefined,
					displayName: undefined,
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
					serverSize: undefined,
				},
				{ readFile: async () => bytes },
			);

			assert(result.success);

			expect(result.data.fileHash).toHaveLength(64);
		});

		it("should propagate declared metadata fields onto the desired state", async () => {
			expect.assertions(3);

			const bytes = new Uint8Array([0x3c, 0x72, 0x6f, 0x62]);
			const result = await placeKind.normalize(
				{
					key: asResourceKey("start-place"),
					description: "Lobby description.",
					displayName: "Start Place",
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
					serverSize: 50,
				},
				{ readFile: async () => bytes },
			);

			assert(result.success);

			expect(result.data.displayName).toBe("Start Place");
			expect(result.data.description).toBe("Lobby description.");
			expect(result.data.serverSize).toBe(50);
		});

		it("should surface a fileReadFailed error when readFile rejects", async () => {
			expect.assertions(1);

			const result = await placeKind.normalize(
				{
					key: asResourceKey("start-place"),
					description: undefined,
					displayName: undefined,
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
					serverSize: undefined,
				},
				{
					readFile: async () => {
						throw new Error("ENOENT");
					},
				},
			);

			assert(!result.success);

			expect(result.err).toStrictEqual({
				key: asResourceKey("start-place"),
				filePath: "places/start.rbxl",
				kind: "fileReadFailed",
				reason: "ENOENT",
			});
		});
	});

	describe("fieldsEqual", () => {
		it("should return true when every managed field matches", () => {
			expect.assertions(1);

			expect(placeKind.fieldsEqual(placeDesired(), placeCurrent())).toBeTrue();
		});

		it.for<[label: string, currentOverrides: Partial<ResourceCurrentStatePlace>]>([
			["fileHash", { fileHash: ALT_HASH }],
			["filePath", { filePath: "places/renamed.rbxl" }],
			["placeId", { placeId: asRobloxAssetId("9999") }],
		])("should return false when %s differs", ([, overrides]) => {
			expect.assertions(1);

			expect(placeKind.fieldsEqual(placeDesired(), placeCurrent(overrides))).toBeFalse();
		});

		it.for<
			[
				label: string,
				desiredOverrides: Partial<PlaceDesiredStateOnly>,
				currentOverrides: Partial<ResourceCurrentStatePlace>,
			]
		>([
			["displayName", { displayName: "New Name" }, { displayName: "Old Name" }],
			["description", { description: "New body." }, { description: "Old body." }],
			["serverSize", { serverSize: 25 }, { serverSize: 50 }],
		])(
			"should return false when desired declares a different %s than current",
			([, desiredOverrides, currentOverrides]) => {
				expect.assertions(1);

				expect(
					placeKind.fieldsEqual(
						placeDesired(desiredOverrides),
						placeCurrent(currentOverrides),
					),
				).toBeFalse();
			},
		);

		it.for<[label: string, currentOverrides: Partial<ResourceCurrentStatePlace>]>([
			["displayName", { displayName: "Server Owned" }],
			["description", { description: "Server owned body." }],
			["serverSize", { serverSize: 100 }],
		])(
			"should return true when desired leaves %s unmanaged but current carries a value",
			([, currentOverrides]) => {
				expect.assertions(1);

				expect(
					placeKind.fieldsEqual(placeDesired(), placeCurrent(currentOverrides)),
				).toBeTrue();
			},
		);

		it.for<
			[
				label: string,
				overrides: Partial<PlaceDesiredStateOnly> & Partial<ResourceCurrentStatePlace>,
			]
		>([
			["displayName", { displayName: "Lobby" }],
			["description", { description: "Lobby body." }],
			["serverSize", { serverSize: 50 }],
		])(
			"should return true when desired declares %s and current carries the same value",
			([, overrides]) => {
				expect.assertions(1);

				expect(
					placeKind.fieldsEqual(placeDesired(overrides), placeCurrent(overrides)),
				).toBeTrue();
			},
		);
	});
});

type ResourceCurrentStatePlace = Parameters<typeof placeKind.fieldsEqual>[1];
type PlaceDesiredStateOnly = Parameters<typeof placeKind.fieldsEqual>[0];
