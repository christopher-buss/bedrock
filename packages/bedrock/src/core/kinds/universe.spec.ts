import { universeCurrent, universeDesired } from "#tests/helpers/resources";
import { ArkErrors } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId } from "../../types/ids.ts";
import { UNIVERSE_SINGLETON_KEY } from "../resources.ts";
import { universeKind } from "./universe.ts";

const NORMALIZE_IO_NEVER = {
	readFile: async (): Promise<Uint8Array> => {
		throw new Error("normalize should not touch the file system");
	},
};

const BlankFlags = {
	consoleEnabled: undefined,
	desktopEnabled: undefined,
	displayName: undefined,
	mobileEnabled: undefined,
	tabletEnabled: undefined,
	vrEnabled: undefined,
} as const;

describe("universeKind", () => {
	it("should tag its kind discriminator as universe", () => {
		expect.assertions(1);

		expect(universeKind.kind).toBe("universe");
	});

	describe("entrySchema", () => {
		it("should accept an entry declaring just universeId", () => {
			expect.assertions(1);

			expect(universeKind.entrySchema({ universeId: "1234567890" })).not.toBeInstanceOf(
				ArkErrors,
			);
		});
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
	});

	describe("normalize", () => {
		it("should pass every declared field through unchanged without touching I/O", async () => {
			expect.assertions(1);

			const result = await universeKind.normalize(
				{
					...BlankFlags,
					key: UNIVERSE_SINGLETON_KEY,
					kind: "universe",
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: true,
				},
				NORMALIZE_IO_NEVER,
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
