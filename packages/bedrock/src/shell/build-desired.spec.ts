import { PLATFORM_FLAG_ROWS } from "#tests/helpers/resources";
import { assert, describe, expect, it, vi } from "vitest";

import type { GamePassDesiredInput } from "../core/flatten.ts";
import { UNIVERSE_SINGLETON_KEY } from "../core/resources.ts";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { buildDesired } from "./build-desired.ts";

function gamePassInput(overrides?: Partial<GamePassDesiredInput>): GamePassDesiredInput {
	return {
		key: asResourceKey("vip-pass"),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		icon: { "en-us": "assets/vip-icon.png" },
		kind: "gamePass",
		price: 500,
		...overrides,
	};
}

describe(buildDesired, () => {
	it("should return an empty Ok when given no inputs", async () => {
		expect.assertions(2);

		const readFile = vi.fn<(path: string) => Promise<Uint8Array>>();

		const result = await buildDesired([], readFile);

		expect(result).toStrictEqual({ data: [], success: true });
		expect(readFile).not.toHaveBeenCalled();
	});

	it("should populate ResourceDesiredState and compute the SHA-256 hash from icon bytes", async () => {
		expect.assertions(1);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await buildDesired([gamePassInput()], readFile);

		expect(result).toStrictEqual({
			data: [
				{
					key: "vip-pass",
					name: "VIP Pass",
					description: "Grants VIP perks.",
					icon: { "en-us": "assets/vip-icon.png" },
					iconFileHashes: {
						"en-us": "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
					},
					kind: "gamePass",
					price: 500,
				},
			],
			success: true,
		});
	});

	it("should encode single-nibble bytes with a leading zero and emit lowercase hex", async () => {
		expect.assertions(1);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockResolvedValue(new Uint8Array([0]));

		const result = await buildDesired([gamePassInput()], readFile);

		assert(result.success);

		const entry = result.data[0]!;
		assert(entry.kind === "gamePass");

		expect(entry.iconFileHashes).toStrictEqual({
			"en-us": "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
		});
	});

	it("should preserve input order across multiple inputs", async () => {
		expect.assertions(1);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await buildDesired(
			[
				gamePassInput({ key: asResourceKey("first-pass") }),
				gamePassInput({ key: asResourceKey("second-pass") }),
			],
			readFile,
		);

		assert(result.success);

		expect(result.data.map((state) => state.key)).toStrictEqual(["first-pass", "second-pass"]);
	});

	it.for<[label: string, rejection: unknown, expectedReason: string]>([
		["Error instance", new Error("ENOENT"), "ENOENT"],
		["string rejection", "ENOENT", "ENOENT"],
	])(
		"should return a fileReadFailed Err when readFile rejects with %s on a game-pass icon",
		async ([, rejection, expectedReason]) => {
			expect.assertions(1);

			const readFile = vi
				.fn<(path: string) => Promise<Uint8Array>>()
				.mockRejectedValueOnce(rejection);

			const result = await buildDesired([gamePassInput()], readFile);

			expect(result).toStrictEqual({
				err: {
					key: "vip-pass",
					filePath: "assets/vip-icon.png",
					kind: "fileReadFailed",
					reason: expectedReason,
				},
				success: false,
			});
		},
	);

	it("should hash a place file and emit a PlaceDesiredState", async () => {
		expect.assertions(1);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await buildDesired(
			[
				{
					key: asResourceKey("start-place"),
					description: undefined,
					displayName: undefined,
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
					serverSize: undefined,
				},
			],
			readFile,
		);

		expect(result).toStrictEqual({
			data: [
				{
					key: "start-place",
					description: undefined,
					displayName: undefined,
					fileHash: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: "4711",
					serverSize: undefined,
				},
			],
			success: true,
		});
	});

	it("should return a fileReadFailed Err when readFile rejects on a place file", async () => {
		expect.assertions(1);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockRejectedValueOnce(new Error("ENOENT"));

		const result = await buildDesired(
			[
				{
					key: asResourceKey("start-place"),
					description: undefined,
					displayName: undefined,
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
					serverSize: undefined,
				},
			],
			readFile,
		);

		expect(result).toStrictEqual({
			err: {
				key: "start-place",
				filePath: "places/start.rbxl",
				kind: "fileReadFailed",
				reason: "ENOENT",
			},
			success: false,
		});
	});

	it("should emit game-pass and place entries in declaration order", async () => {
		expect.assertions(1);

		const readFile = vi
			.fn<(path: string) => Promise<Uint8Array>>()
			.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await buildDesired(
			[
				gamePassInput(),
				{
					key: asResourceKey("start-place"),
					description: undefined,
					displayName: undefined,
					filePath: "places/start.rbxl",
					kind: "place",
					placeId: asRobloxAssetId("4711"),
					serverSize: undefined,
				},
			],
			readFile,
		);

		assert(result.success);

		expect(result.data.map((entry) => entry.kind)).toStrictEqual(["gamePass", "place"]);
	});

	it("should pass a universe input straight through without calling readFile", async () => {
		expect.assertions(2);

		const readFile = vi.fn<(path: string) => Promise<Uint8Array>>();

		const result = await buildDesired(
			[
				{
					key: UNIVERSE_SINGLETON_KEY,
					consoleEnabled: undefined,
					desktopEnabled: true,
					displayName: undefined,
					kind: "universe",
					mobileEnabled: undefined,
					tabletEnabled: undefined,
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: true,
					vrEnabled: undefined,
				},
			],
			readFile,
		);

		expect(result).toStrictEqual({
			data: [
				{
					key: UNIVERSE_SINGLETON_KEY,
					consoleEnabled: undefined,
					desktopEnabled: true,
					displayName: undefined,
					kind: "universe",
					mobileEnabled: undefined,
					tabletEnabled: undefined,
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: true,
					vrEnabled: undefined,
				},
			],
			success: true,
		});
		expect(readFile).not.toHaveBeenCalled();
	});

	it("should preserve undefined voiceChatEnabled on a universe input", async () => {
		expect.assertions(1);

		const readFile = vi.fn<(path: string) => Promise<Uint8Array>>();

		const result = await buildDesired(
			[
				{
					key: UNIVERSE_SINGLETON_KEY,
					consoleEnabled: undefined,
					desktopEnabled: undefined,
					displayName: undefined,
					kind: "universe",
					mobileEnabled: undefined,
					tabletEnabled: undefined,
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: undefined,
					vrEnabled: undefined,
				},
			],
			readFile,
		);

		assert(result.success);
		assert(result.data[0]!.kind === "universe");

		expect(result.data[0]!.voiceChatEnabled).toBeUndefined();
	});

	it.for(PLATFORM_FLAG_ROWS)(
		"should propagate a declared %s through to universe desired state",
		async ([flag]) => {
			expect.assertions(1);

			const readFile = vi.fn<(path: string) => Promise<Uint8Array>>();

			const baseInput = {
				key: UNIVERSE_SINGLETON_KEY,
				consoleEnabled: undefined,
				desktopEnabled: undefined,
				displayName: undefined,
				kind: "universe" as const,
				mobileEnabled: undefined,
				tabletEnabled: undefined,
				universeId: asRobloxAssetId("1234567890"),
				voiceChatEnabled: undefined,
				vrEnabled: undefined,
			};
			const result = await buildDesired([{ ...baseInput, [flag]: true }], readFile);

			assert(result.success);
			assert(result.data[0]!.kind === "universe");

			expect(result.data[0]![flag]).toBeTrue();
		},
	);

	it("should carry a declared privateServerPriceRobux onto the universe desired state", async () => {
		expect.assertions(2);

		const readFile = vi.fn<(path: string) => Promise<Uint8Array>>();

		const result = await buildDesired(
			[
				{
					key: UNIVERSE_SINGLETON_KEY,
					consoleEnabled: undefined,
					desktopEnabled: undefined,
					displayName: undefined,
					kind: "universe",
					mobileEnabled: undefined,
					privateServerPriceRobux: 250,
					tabletEnabled: undefined,
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: undefined,
					vrEnabled: undefined,
				},
			],
			readFile,
		);

		assert(result.success);
		assert(result.data[0]!.kind === "universe");

		expect("privateServerPriceRobux" in result.data[0]!).toBeTrue();
		expect(result.data[0]!.privateServerPriceRobux).toBe(250);
	});

	it("should omit privateServerPriceRobux from desired state when absent from the input", async () => {
		expect.assertions(1);

		const readFile = vi.fn<(path: string) => Promise<Uint8Array>>();

		const result = await buildDesired(
			[
				{
					key: UNIVERSE_SINGLETON_KEY,
					consoleEnabled: undefined,
					desktopEnabled: undefined,
					displayName: undefined,
					kind: "universe",
					mobileEnabled: undefined,
					tabletEnabled: undefined,
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: undefined,
					vrEnabled: undefined,
				},
			],
			readFile,
		);

		assert(result.success);
		assert(result.data[0]!.kind === "universe");

		expect("privateServerPriceRobux" in result.data[0]!).toBeFalse();
	});
});
