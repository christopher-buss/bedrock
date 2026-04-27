import { gamePassCurrent, gamePassDesired } from "#tests/helpers/resources";
import { ArkErrors } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asSha256Hex } from "../../types/ids.ts";
import { gamePassKind } from "./game-pass.ts";

const ALT_HASH = asSha256Hex("a3f2c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852e1b0");

const INVALID_ROBUX_PRICES = [
	["a negative integer", -1],
	["a fractional value", 99.5],
	["NaN", Number.NaN],
	["Infinity", Number.POSITIVE_INFINITY],
] as const;

const ValidGamePass = {
	name: "VIP Pass",
	description: "Grants VIP perks.",
	iconFilePath: "assets/vip.png",
} as const;

describe("gamePassKind", () => {
	it("should tag its kind discriminator as gamePass", () => {
		expect.assertions(1);

		expect(gamePassKind.kind).toBe("gamePass");
	});

	describe("entrySchema", () => {
		it("should accept a valid entry that omits price", () => {
			expect.assertions(1);

			expect(gamePassKind.entrySchema(ValidGamePass)).not.toBeInstanceOf(ArkErrors);
		});

		it("should accept a valid entry with a non-negative integer price", () => {
			expect.assertions(1);

			expect(gamePassKind.entrySchema({ ...ValidGamePass, price: 100 })).not.toBeInstanceOf(
				ArkErrors,
			);
		});

		it.for(INVALID_ROBUX_PRICES)("should reject %s as a price", ([, price]) => {
			expect.assertions(1);

			expect(gamePassKind.entrySchema({ ...ValidGamePass, price })).toBeInstanceOf(ArkErrors);
		});
	});

	describe("flatten", () => {
		it("should emit a tagged input per entry in config.passes", () => {
			expect.assertions(1);

			expect(
				gamePassKind.flatten({
					environments: { production: {} },
					passes: {
						"vip-pass": {
							name: "VIP",
							description: "Perks",
							iconFilePath: "assets/vip.png",
							price: 500,
						},
					},
				}),
			).toStrictEqual([
				{
					key: asResourceKey("vip-pass"),
					name: "VIP",
					description: "Perks",
					iconFilePath: "assets/vip.png",
					kind: "gamePass",
					price: 500,
				},
			]);
		});

		it("should emit an empty list when the config has no passes", () => {
			expect.assertions(1);

			expect(gamePassKind.flatten({ environments: { production: {} } })).toBeEmpty();
		});

		it("should preserve the insertion order of config.passes entries", () => {
			expect.assertions(1);

			const inputs = gamePassKind.flatten({
				environments: { production: {} },
				passes: {
					"alpha-pass": { name: "Alpha", description: "a", iconFilePath: "a.png" },
					"beta-pass": { name: "Beta", description: "b", iconFilePath: "b.png" },
				},
			});

			expect(inputs.map((input) => input.key)).toStrictEqual([
				asResourceKey("alpha-pass"),
				asResourceKey("beta-pass"),
			]);
		});
	});

	describe("normalize", () => {
		it("should layer a sha256 hex digest of the icon bytes onto the desired state", async () => {
			expect.assertions(2);

			const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
			const result = await gamePassKind.normalize(
				{
					key: asResourceKey("vip-pass"),
					name: "VIP",
					description: "Perks",
					iconFilePath: "assets/vip.png",
					kind: "gamePass",
					price: 500,
				},
				{ readFile: async () => bytes },
			);

			assert(result.success);

			expect(result.data.iconFileHash).toHaveLength(64);
			expect(result.data.kind).toBe("gamePass");
		});

		it("should surface a fileReadFailed error carrying the icon path when readFile rejects", async () => {
			expect.assertions(1);

			const result = await gamePassKind.normalize(
				{
					key: asResourceKey("vip-pass"),
					name: "VIP",
					description: "Perks",
					iconFilePath: "assets/vip.png",
					kind: "gamePass",
					price: undefined,
				},
				{
					readFile: async () => {
						throw new Error("ENOENT");
					},
				},
			);

			assert(!result.success);

			expect(result.err).toStrictEqual({
				key: asResourceKey("vip-pass"),
				filePath: "assets/vip.png",
				kind: "fileReadFailed",
				reason: "ENOENT",
			});
		});
	});

	describe("fieldsEqual", () => {
		it("should return true when every managed field matches", () => {
			expect.assertions(1);

			expect(gamePassKind.fieldsEqual(gamePassDesired(), gamePassCurrent())).toBeTrue();
		});

		it.for<[label: string, currentOverrides: Partial<ResourceCurrentStateGamePass>]>([
			["name", { name: "Other Name" }],
			["description", { description: "Other" }],
			["iconFileHash", { iconFileHash: ALT_HASH }],
			["iconFilePath", { iconFilePath: "assets/other.png" }],
			["price", { price: 999 }],
		])("should return false when %s differs", ([, overrides]) => {
			expect.assertions(1);

			expect(
				gamePassKind.fieldsEqual(gamePassDesired(), gamePassCurrent(overrides)),
			).toBeFalse();
		});
	});
});

type ResourceCurrentStateGamePass = Parameters<typeof gamePassKind.fieldsEqual>[1];
