import { universeCurrent, universeDesired } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId } from "../../types/ids.ts";
import { UNIVERSE_SINGLETON_KEY } from "../resources.ts";
import { universeKind } from "./universe.ts";

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
					universe: { universeId: "1234567890", voiceChatEnabled: true },
				}),
			).toStrictEqual([
				{
					key: UNIVERSE_SINGLETON_KEY,
					kind: "universe",
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: true,
				},
			]);
		});

		it("should emit an empty list when the config has no universe block", () => {
			expect.assertions(1);

			expect(universeKind.flatten({})).toBeEmpty();
		});

		it("should pass voiceChatEnabled through as undefined when omitted", () => {
			expect.assertions(1);

			const inputs = universeKind.flatten({ universe: { universeId: "1234567890" } });

			expect(inputs[0]?.voiceChatEnabled).toBeUndefined();
		});
	});

	describe("normalize", () => {
		it("should return the input's fields unchanged without touching I/O", async () => {
			expect.assertions(1);

			const result = await universeKind.normalize(
				{
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
			["voiceChatEnabled", { voiceChatEnabled: true }],
		])("should return false when %s differs", ([, overrides]) => {
			expect.assertions(1);

			expect(
				universeKind.fieldsEqual(universeDesired(), universeCurrent(overrides)),
			).toBeFalse();
		});
	});
});

type ResourceCurrentStateUniverse = Parameters<typeof universeKind.fieldsEqual>[1];
