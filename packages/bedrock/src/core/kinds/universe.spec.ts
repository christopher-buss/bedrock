import { universeCurrent, universeDesired } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId } from "../../types/ids.ts";
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
		it("should return the input's fields unchanged without touching I/O", async () => {
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
						throw new Error("normalize should not read files for universe");
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
	});
});

type ResourceCurrentStateUniverse = Parameters<typeof universeKind.fieldsEqual>[1];
