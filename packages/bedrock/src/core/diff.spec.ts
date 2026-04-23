import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { diff } from "./diff.ts";
import type { GamePassDesiredState, PlaceDesiredState, ResourceCurrentState } from "./resources.ts";

const DEFAULT_HASH = asSha256Hex(
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
);
const ALT_HASH = asSha256Hex("a3f2c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852e1b0");
const PLACE_KEY = asResourceKey("start-place");
const PLACE_ID = asRobloxAssetId("4711");
const PLACE_HASH = asSha256Hex("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");

function placeDesired(overrides?: Partial<PlaceDesiredState>): PlaceDesiredState {
	return {
		key: PLACE_KEY,
		fileHash: PLACE_HASH,
		filePath: "places/start.rbxl",
		kind: "place",
		placeId: PLACE_ID,
		...overrides,
	};
}

function placeCurrent(
	overrides?: Partial<ResourceCurrentState<"place">>,
): ResourceCurrentState<"place"> {
	return {
		...placeDesired(),
		outputs: { versionNumber: 1 },
		...overrides,
	};
}

function gamePassDesired(overrides?: Partial<GamePassDesiredState>): GamePassDesiredState {
	return {
		key: asResourceKey("vip-pass"),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		iconFileHash: DEFAULT_HASH,
		iconFilePath: "assets/vip-icon.png",
		kind: "gamePass",
		price: 500,
		...overrides,
	};
}

function gamePassCurrent(
	overrides?: Partial<ResourceCurrentState<"gamePass">>,
): ResourceCurrentState<"gamePass"> {
	return {
		key: asResourceKey("vip-pass"),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		iconFileHash: DEFAULT_HASH,
		iconFilePath: "assets/vip-icon.png",
		kind: "gamePass",
		outputs: {
			assetId: asRobloxAssetId("9876543210"),
			iconAssetId: asRobloxAssetId("1122334455"),
		},
		price: 500,
		...overrides,
	};
}

describe(diff, () => {
	it("should return an empty list when both snapshots are empty", () => {
		expect.assertions(1);

		expect(diff([], [])).toBeEmpty();
	});

	it("should emit a create op carrying the desired entry when current is missing the key", () => {
		expect.assertions(2);

		const desiredEntry = gamePassDesired();

		const ops = diff([desiredEntry], []);

		expect(ops).toStrictEqual([
			{ key: desiredEntry.key, desired: desiredEntry, type: "create" },
		]);

		const op = ops[0]!;
		assert(op.type === "create");

		// Referential identity proves the function does not clone the input.
		expect(op.desired).toBe(desiredEntry);
	});

	it("should emit a bare noop op when every desired field matches current", () => {
		expect.assertions(1);

		const desiredEntry = gamePassDesired();
		const currentEntry = gamePassCurrent();

		expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
			{ key: desiredEntry.key, type: "noop" },
		]);
	});

	it.for<
		[
			label: string,
			desiredOverrides: Partial<GamePassDesiredState>,
			currentOverrides: Partial<ResourceCurrentState<"gamePass">>,
		]
	>([
		["name", { name: "VIP Pass v2" }, {}],
		["description", { description: "Grants VIP perks plus emote." }, {}],
		["iconFileHash", { iconFileHash: ALT_HASH }, {}],
		["iconFilePath", { iconFilePath: "assets/vip-icon-v2.png" }, {}],
		["price", { price: 750 }, {}],
		["price undefined vs number", { price: undefined }, { price: 0 }],
	])(
		"should emit an update op when %s differs between desired and current",
		([, desiredOverrides, currentOverrides]) => {
			expect.assertions(3);

			const desiredEntry = gamePassDesired(desiredOverrides);
			const currentEntry = gamePassCurrent(currentOverrides);

			const ops = diff([desiredEntry], [currentEntry]);

			expect(ops).toHaveLength(1);

			const op = ops[0]!;
			assert(op.type === "update");

			expect(op.desired).toBe(desiredEntry);
			expect(op.current).toBe(currentEntry);
		},
	);

	it("should treat price undefined on both sides as a noop", () => {
		expect.assertions(1);

		const desiredEntry = gamePassDesired({ price: undefined });
		const currentEntry = gamePassCurrent({ price: undefined });

		expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
			{ key: desiredEntry.key, type: "noop" },
		]);
	});

	it("should omit orphan current entries whose key is not in desired", () => {
		expect.assertions(2);

		const orphanKey = asResourceKey("orphan-pass");
		const currentEntry = gamePassCurrent({ key: orphanKey });

		const ops = diff([], [currentEntry]);

		expect(ops).toBeEmpty();
		expect(ops.map((op) => op.key)).not.toContain(orphanKey);
	});

	it("should preserve desired order and emit the correct op per entry across a mixed batch", () => {
		expect.assertions(1);

		const createKey = asResourceKey("new-pass");
		const matchingKey = asResourceKey("matching-pass");
		const driftedKey = asResourceKey("drifted-pass");
		const orphanKey = asResourceKey("orphan-pass");

		const desiredCreate = gamePassDesired({ key: createKey, name: "New Pass" });
		const desiredMatching = gamePassDesired({
			key: matchingKey,
			name: "Matching Pass",
		});
		const desiredDrifted = gamePassDesired({
			key: driftedKey,
			name: "Drifted Pass v2",
		});

		const currentMatching = gamePassCurrent({
			key: matchingKey,
			name: "Matching Pass",
		});
		const currentDrifted = gamePassCurrent({
			key: driftedKey,
			name: "Drifted Pass v1",
		});
		const currentOrphan = gamePassCurrent({ key: orphanKey });

		const ops = diff(
			[desiredCreate, desiredMatching, desiredDrifted],
			[currentMatching, currentDrifted, currentOrphan],
		);

		expect(ops).toStrictEqual([
			{ key: createKey, desired: desiredCreate, type: "create" },
			{ key: matchingKey, type: "noop" },
			{
				key: driftedKey,
				current: currentDrifted,
				desired: desiredDrifted,
				type: "update",
			},
		]);
	});

	describe("place kind", () => {
		it("should emit a noop when the place file hash matches", () => {
			expect.assertions(1);

			const desiredEntry = placeDesired();
			const currentEntry = placeCurrent();

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{ key: PLACE_KEY, type: "noop" },
			]);
		});

		it("should emit an update op when the place file hash differs", () => {
			expect.assertions(1);

			const desiredEntry = placeDesired({ fileHash: ALT_HASH });
			const currentEntry = placeCurrent();

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{ key: PLACE_KEY, current: currentEntry, desired: desiredEntry, type: "update" },
			]);
		});

		it("should emit an update op when placeId differs", () => {
			expect.assertions(1);

			const desiredEntry = placeDesired({ placeId: asRobloxAssetId("9999") });
			const currentEntry = placeCurrent();

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{ key: PLACE_KEY, current: currentEntry, desired: desiredEntry, type: "update" },
			]);
		});

		it("should emit a create op when the place is absent from current state", () => {
			expect.assertions(1);

			const desiredEntry = placeDesired();

			expect(diff([desiredEntry], [])).toStrictEqual([
				{ key: PLACE_KEY, desired: desiredEntry, type: "create" },
			]);
		});

		it("should emit an update op when the key maps to a different kind in current state", () => {
			expect.assertions(1);

			const desiredEntry = placeDesired();
			const currentEntry = gamePassCurrent({ key: PLACE_KEY });

			const ops = diff([desiredEntry], [currentEntry]);

			expect(ops).toStrictEqual([
				{ key: PLACE_KEY, current: currentEntry, desired: desiredEntry, type: "update" },
			]);
		});
	});
});
