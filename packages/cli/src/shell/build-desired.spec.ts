import { assert, describe, expect, it, vi } from "vitest";

import { isSha256Hex } from "../types/ids.ts";
import { buildDesired, type GamePassConfigInput } from "./build-desired.ts";

function gamePassConfig(overrides?: Partial<GamePassConfigInput>): GamePassConfigInput {
	return {
		key: "vip-pass",
		name: "VIP Pass",
		description: "Grants VIP perks.",
		iconFilePath: "assets/vip-icon.png",
		price: 500,
		...overrides,
	};
}

describe(buildDesired, () => {
	it("should return an empty Ok when the config has no game passes", async () => {
		expect.assertions(2);

		const readFile = vi.fn<(path: string) => Promise<Uint8Array>>();

		const result = await buildDesired({ gamePasses: [] }, readFile);

		expect(result).toStrictEqual({ data: [], success: true });
		expect(readFile).not.toHaveBeenCalled();
	});

	it("should populate ResourceDesiredState and compute the SHA-256 hash from icon bytes", async () => {
		expect.assertions(2);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await buildDesired({ gamePasses: [gamePassConfig()] }, readFile);

		assert(result.success);

		expect(result.data).toStrictEqual([
			{
				key: "vip-pass",
				name: "VIP Pass",
				description: "Grants VIP perks.",
				iconFileHash: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
				iconFilePath: "assets/vip-icon.png",
				kind: "gamePass",
				price: 500,
			},
		]);
		expect(isSha256Hex(result.data[0]!.iconFileHash)).toBeTrue();
	});

	it("should encode single-nibble bytes with a leading zero and emit lowercase hex", async () => {
		expect.assertions(1);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockResolvedValue(new Uint8Array([0]));

		const result = await buildDesired({ gamePasses: [gamePassConfig()] }, readFile);

		assert(result.success);

		expect(result.data[0]!.iconFileHash).toBe(
			"6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
		);
	});

	it("should preserve input order across multiple game passes", async () => {
		expect.assertions(1);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await buildDesired(
			{
				gamePasses: [
					gamePassConfig({ key: "first-pass" }),
					gamePassConfig({ key: "second-pass" }),
				],
			},
			readFile,
		);

		assert(result.success);

		expect(result.data.map((state) => state.key)).toStrictEqual(["first-pass", "second-pass"]);
	});

	it.for<[label: string, rejection: unknown, expectedReason: string]>([
		["Error instance", new Error("ENOENT"), "ENOENT"],
		["string rejection", "ENOENT", "ENOENT"],
	])(
		"should return an iconReadFailed Err when readFile rejects with %s",
		async ([, rejection, expectedReason]) => {
			expect.assertions(1);

			const readFile = vi
				.fn<(path: string) => Promise<Uint8Array>>()
				.mockRejectedValueOnce(rejection);

			const result = await buildDesired({ gamePasses: [gamePassConfig()] }, readFile);

			expect(result).toStrictEqual({
				err: {
					key: "vip-pass",
					iconFilePath: "assets/vip-icon.png",
					kind: "iconReadFailed",
					reason: expectedReason,
				},
				success: false,
			});
		},
	);

	it.for<[label: string, rawKey: string]>([
		["empty string", ""],
		["contains whitespace", "has space"],
		["contains slash", "bad/slash"],
	])(
		"should return an invalidKey Err without any I/O when the raw key is %s",
		async ([, rawKey]) => {
			expect.assertions(2);

			const readFile = vi.fn<(path: string) => Promise<Uint8Array>>();

			const result = await buildDesired(
				{ gamePasses: [gamePassConfig({ key: rawKey })] },
				readFile,
			);

			expect(result).toStrictEqual({
				err: { kind: "invalidKey", rawKey },
				success: false,
			});
			expect(readFile).not.toHaveBeenCalled();
		},
	);

	it("should validate every key before any icon read so a later invalid key skips earlier I/O", async () => {
		expect.assertions(2);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await buildDesired(
			{
				gamePasses: [
					gamePassConfig({ key: "valid-first" }),
					gamePassConfig({ key: "has space" }),
				],
			},
			readFile,
		);

		expect(result).toStrictEqual({
			err: { kind: "invalidKey", rawKey: "has space" },
			success: false,
		});
		expect(readFile).not.toHaveBeenCalled();
	});
});
