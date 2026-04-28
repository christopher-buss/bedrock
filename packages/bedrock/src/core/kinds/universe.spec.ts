import { universeCurrent, universeDesired } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import { UNIVERSE_SINGLETON_KEY } from "../resources.ts";
import { universeKind } from "./universe.ts";

const BlankFlags = {
	consoleEnabled: undefined,
	desktopEnabled: undefined,
	displayName: undefined,
	mobileEnabled: undefined,
	tabletEnabled: undefined,
	visibility: undefined,
	vrEnabled: undefined,
} as const;

describe("universeKind", () => {
	it("should tag its kind discriminator as universe", () => {
		expect.assertions(1);

		expect(universeKind.kind).toBe("universe");
	});

	describe("flatten", () => {
		it("should emit one singleton input stamped with the universe key when present", () => {
			expect.assertions(1);

			expect(
				universeKind.flatten({
					environments: { production: {} },
					universe: { universeId: "1234567890", voiceChatEnabled: true },
				}),
			).toStrictEqual([
				{
					...BlankFlags,
					key: UNIVERSE_SINGLETON_KEY,
					kind: "universe",
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: true,
				},
			]);
		});

		it("should emit an empty list when the config has no universe block", () => {
			expect.assertions(1);

			expect(universeKind.flatten({ environments: { production: {} } })).toBeEmpty();
		});

		it("should pass voiceChatEnabled through as undefined when omitted", () => {
			expect.assertions(1);

			const inputs = universeKind.flatten({
				environments: { production: {} },
				universe: { universeId: "1234567890" },
			});

			expect(inputs[0]?.voiceChatEnabled).toBeUndefined();
		});

		it("should propagate icon onto the flattened input when declared", () => {
			expect.assertions(1);

			const inputs = universeKind.flatten({
				environments: { production: {} },
				universe: {
					icon: { "en-us": "assets/icon.png" },
					universeId: "1234567890",
				},
			});

			expect(inputs[0]?.icon).toStrictEqual({ "en-us": "assets/icon.png" });
		});

		it("should omit icon from the flattened input when not declared", () => {
			expect.assertions(1);

			const inputs = universeKind.flatten({
				environments: { production: {} },
				universe: { universeId: "1234567890" },
			});

			expect(inputs[0]).not.toContainKey("icon");
		});
	});

	describe("normalize", () => {
		it("should return the input's fields unchanged without touching I/O when no icon is declared", async () => {
			expect.assertions(1);

			const result = await universeKind.normalize(
				{
					...BlankFlags,
					key: UNIVERSE_SINGLETON_KEY,
					kind: "universe",
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: true,
				},
				{
					readFile: async () => {
						throw new Error("normalize should not read files when icon is absent");
					},
				},
			);

			assert(result.success);

			expect(result.data).toStrictEqual({
				...BlankFlags,
				key: UNIVERSE_SINGLETON_KEY,
				kind: "universe",
				universeId: asRobloxAssetId("1234567890"),
				voiceChatEnabled: true,
			});
		});

		it("should attach a sha256 hex digest under iconFileHashes for each declared locale", async () => {
			expect.assertions(3);

			const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
			const result = await universeKind.normalize(
				{
					...BlankFlags,
					key: UNIVERSE_SINGLETON_KEY,
					icon: { "en-us": "assets/icon.png" },
					kind: "universe",
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: undefined,
				},
				{ readFile: async () => bytes },
			);

			assert(result.success);

			expect(result.data.icon).toStrictEqual({ "en-us": "assets/icon.png" });
			expect(result.data.iconFileHashes).toContainKey("en-us");
			expect(result.data.iconFileHashes!["en-us"]).toHaveLength(64);
		});

		it("should surface a fileReadFailed error carrying the icon path when readFile rejects", async () => {
			expect.assertions(1);

			const result = await universeKind.normalize(
				{
					...BlankFlags,
					key: UNIVERSE_SINGLETON_KEY,
					icon: { "en-us": "assets/missing.png" },
					kind: "universe",
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: undefined,
				},
				{
					readFile: async () => {
						throw new Error("ENOENT");
					},
				},
			);

			assert(!result.success);

			expect(result.err).toMatchObject({
				filePath: "assets/missing.png",
				kind: "fileReadFailed",
			});
		});
	});

	describe("fieldsEqual", () => {
		it("should return true when every managed field matches", () => {
			expect.assertions(1);

			expect(universeKind.fieldsEqual(universeDesired(), universeCurrent())).toBeTrue();
		});

		it.for<[label: string, currentOverrides: Partial<ResourceCurrentStateUniverse>]>([
			["universeId", { universeId: asRobloxAssetId("9999999999") }],
		])("should return false when %s differs", ([, overrides]) => {
			expect.assertions(1);

			expect(
				universeKind.fieldsEqual(universeDesired(), universeCurrent(overrides)),
			).toBeFalse();
		});

		it("should return true when icon and iconFileHashes match across both sides", () => {
			expect.assertions(1);

			const Overrides = {
				icon: { "en-us": "assets/icon.png" },
				iconFileHashes: {
					"en-us": asSha256Hex(
						"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					),
				},
			} as const;

			expect(
				universeKind.fieldsEqual(universeDesired(Overrides), universeCurrent(Overrides)),
			).toBeTrue();
		});

		it("should return false when desired declares icon but current does not", () => {
			expect.assertions(1);

			expect(
				universeKind.fieldsEqual(
					universeDesired({
						icon: { "en-us": "assets/icon.png" },
						iconFileHashes: {
							"en-us": asSha256Hex(
								"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
							),
						},
					}),
					universeCurrent(),
				),
			).toBeFalse();
		});

		it("should return false when current declares icon but desired does not", () => {
			expect.assertions(1);

			expect(
				universeKind.fieldsEqual(
					universeDesired(),
					universeCurrent({
						icon: { "en-us": "assets/icon.png" },
						iconFileHashes: {
							"en-us": asSha256Hex(
								"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
							),
						},
					}),
				),
			).toBeFalse();
		});

		it("should return false when the en-us icon hash differs across sides", () => {
			expect.assertions(1);

			const SharedIcon = { "en-us": "assets/icon.png" } as const;

			expect(
				universeKind.fieldsEqual(
					universeDesired({
						icon: SharedIcon,
						iconFileHashes: {
							"en-us": asSha256Hex(
								"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
							),
						},
					}),
					universeCurrent({
						icon: SharedIcon,
						iconFileHashes: {
							"en-us": asSha256Hex(
								"2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
							),
						},
					}),
				),
			).toBeFalse();
		});
	});
});

type ResourceCurrentStateUniverse = Parameters<typeof universeKind.fieldsEqual>[1];
