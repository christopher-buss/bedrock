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
					places: {
						"start-place": { filePath: "places/start.rbxl", placeId: "4711" },
					},
				}),
			).toStrictEqual([
				{
					key: asResourceKey("start-place"),
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
				},
			]);
		});

		it("should emit an empty list when the config has no places", () => {
			expect.assertions(1);

			expect(placeKind.flatten({})).toBeEmpty();
		});
	});

	describe("normalize", () => {
		it("should layer a sha256 hex digest of the file bytes onto the desired state", async () => {
			expect.assertions(1);

			const bytes = new Uint8Array([0x3c, 0x72, 0x6f, 0x62]);
			const result = await placeKind.normalize(
				{
					key: asResourceKey("start-place"),
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
				},
				{ readFile: async () => bytes },
			);

			assert(result.success);

			expect(result.data.fileHash).toHaveLength(64);
		});

		it("should surface a fileReadFailed error when readFile rejects", async () => {
			expect.assertions(1);

			const result = await placeKind.normalize(
				{
					key: asResourceKey("start-place"),
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
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
	});
});

type ResourceCurrentStatePlace = Parameters<typeof placeKind.fieldsEqual>[1];
