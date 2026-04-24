import {
	gamePassCurrent,
	gamePassDesired,
	placeCurrent,
	placeDesired,
	PLATFORM_FLAG_ROWS,
	universeCurrent,
	universeDesired,
} from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { diff } from "./diff.ts";
import { UNIVERSE_SINGLETON_KEY } from "./resources.ts";
import type {
	GamePassDesiredState,
	ResourceCurrentState,
	UniverseDesiredState,
} from "./resources.ts";

const ALT_HASH = asSha256Hex("a3f2c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852e1b0");
const PLACE_KEY = asResourceKey("start-place");

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

		it("should emit an update op when the place filePath differs", () => {
			expect.assertions(1);

			const desiredEntry = placeDesired({ filePath: "places/renamed.rbxl" });
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

		it("should emit an update op when a gamePass desired maps to a place current under the same key", () => {
			expect.assertions(1);

			const desiredEntry = gamePassDesired({ key: PLACE_KEY });
			const currentEntry = placeCurrent();

			const ops = diff([desiredEntry], [currentEntry]);

			expect(ops).toStrictEqual([
				{ key: PLACE_KEY, current: currentEntry, desired: desiredEntry, type: "update" },
			]);
		});
	});

	describe("universe kind", () => {
		it("should emit a create op when the universe is absent from current state", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ voiceChatEnabled: true });

			expect(diff([desiredEntry], [])).toStrictEqual([
				{ key: UNIVERSE_SINGLETON_KEY, desired: desiredEntry, type: "create" },
			]);
		});

		it("should emit a noop on first apply when no managed fields are declared", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired();

			expect(diff([desiredEntry], [])).toStrictEqual([
				{ key: UNIVERSE_SINGLETON_KEY, type: "noop" },
			]);
		});

		it("should emit a noop when universeId matches and no managed fields are declared", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired();
			const currentEntry = universeCurrent({ voiceChatEnabled: false });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{ key: UNIVERSE_SINGLETON_KEY, type: "noop" },
			]);
		});

		it("should emit a noop when a declared managed field matches current", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ voiceChatEnabled: true });
			const currentEntry = universeCurrent({ voiceChatEnabled: true });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{ key: UNIVERSE_SINGLETON_KEY, type: "noop" },
			]);
		});

		it("should emit an update op when a declared voiceChatEnabled differs from current", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ voiceChatEnabled: true });
			const currentEntry = universeCurrent({ voiceChatEnabled: false });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{
					key: UNIVERSE_SINGLETON_KEY,
					current: currentEntry,
					desired: desiredEntry,
					type: "update",
				},
			]);
		});

		it("should emit an update op when universeId differs between desired and current", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({
				universeId: asRobloxAssetId("9999"),
				voiceChatEnabled: true,
			});
			const currentEntry = universeCurrent({ voiceChatEnabled: true });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{
					key: UNIVERSE_SINGLETON_KEY,
					current: currentEntry,
					desired: desiredEntry,
					type: "update",
				},
			]);
		});

		it("should emit an update op when the key maps to a different kind in current state", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ voiceChatEnabled: true });
			const currentEntry = gamePassCurrent({ key: UNIVERSE_SINGLETON_KEY });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{
					key: UNIVERSE_SINGLETON_KEY,
					current: currentEntry,
					desired: desiredEntry,
					type: "update",
				},
			]);
		});

		it.for(PLATFORM_FLAG_ROWS)(
			"should emit an update op when a declared %s differs from current",
			([flag]) => {
				expect.assertions(1);

				const desiredEntry = universeDesired({ [flag]: true });
				const currentEntry = universeCurrent({ [flag]: false });

				expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
					{
						key: UNIVERSE_SINGLETON_KEY,
						current: currentEntry,
						desired: desiredEntry,
						type: "update",
					},
				]);
			},
		);

		it.for(PLATFORM_FLAG_ROWS)(
			"should emit a noop when a declared %s matches current",
			([flag]) => {
				expect.assertions(1);

				const desiredEntry = universeDesired({ [flag]: true });
				const currentEntry = universeCurrent({ [flag]: true });

				expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
					{ key: UNIVERSE_SINGLETON_KEY, type: "noop" },
				]);
			},
		);

		it.for(PLATFORM_FLAG_ROWS)(
			"should not treat a concrete current %s as drift when the flag is undeclared but another is",
			([flag]) => {
				expect.assertions(1);

				const desiredEntry = universeDesired({ voiceChatEnabled: true });
				const currentEntry = universeCurrent({ [flag]: true, voiceChatEnabled: true });

				expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
					{ key: UNIVERSE_SINGLETON_KEY, type: "noop" },
				]);
			},
		);

		it("should emit a noop when every platform flag is declared and matches current", () => {
			expect.assertions(1);

			const allFlags = {
				consoleEnabled: true,
				desktopEnabled: true,
				mobileEnabled: false,
				tabletEnabled: true,
				voiceChatEnabled: true,
				vrEnabled: false,
			} satisfies Partial<UniverseDesiredState>;
			const desiredEntry = universeDesired(allFlags);
			const currentEntry = universeCurrent(allFlags);

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{ key: UNIVERSE_SINGLETON_KEY, type: "noop" },
			]);
		});

		it("should emit an update op when one of several declared flags flips", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({
				desktopEnabled: true,
				mobileEnabled: false,
				voiceChatEnabled: true,
			});
			const currentEntry = universeCurrent({
				desktopEnabled: true,
				mobileEnabled: true,
				voiceChatEnabled: true,
			});

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{
					key: UNIVERSE_SINGLETON_KEY,
					current: currentEntry,
					desired: desiredEntry,
					type: "update",
				},
			]);
		});

		it("should emit a noop when declared subset matches and other flags hold concrete current values", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ desktopEnabled: true });
			const currentEntry = universeCurrent({
				consoleEnabled: false,
				desktopEnabled: true,
				mobileEnabled: true,
				tabletEnabled: false,
				voiceChatEnabled: true,
				vrEnabled: true,
			});

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{ key: UNIVERSE_SINGLETON_KEY, type: "noop" },
			]);
		});

		it("should emit an update op when a declared displayName differs from current", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ displayName: "New Name" });
			const currentEntry = universeCurrent({ displayName: "Old Name" });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{
					key: UNIVERSE_SINGLETON_KEY,
					current: currentEntry,
					desired: desiredEntry,
					type: "update",
				},
			]);
		});

		it("should emit an update op when a declared visibility differs from current", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ visibility: "private" });
			const currentEntry = universeCurrent({ visibility: "public" });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{
					key: UNIVERSE_SINGLETON_KEY,
					current: currentEntry,
					desired: desiredEntry,
					type: "update",
				},
			]);
		});

		it("should emit an update op when a declared privateServerPriceRobux differs from current", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ privateServerPriceRobux: 250 });
			const currentEntry = universeCurrent({ privateServerPriceRobux: 100 });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{
					key: UNIVERSE_SINGLETON_KEY,
					current: currentEntry,
					desired: desiredEntry,
					type: "update",
				},
			]);
		});

		it("should emit an update op when privateServerPriceRobux is declared as undefined and current has a value", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ privateServerPriceRobux: undefined });
			const currentEntry = universeCurrent({ privateServerPriceRobux: 100 });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{
					key: UNIVERSE_SINGLETON_KEY,
					current: currentEntry,
					desired: desiredEntry,
					type: "update",
				},
			]);
		});

		it("should emit a noop when privateServerPriceRobux is omitted from desired and current has a value", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired();
			const currentEntry = universeCurrent({ privateServerPriceRobux: 100 });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{ key: UNIVERSE_SINGLETON_KEY, type: "noop" },
			]);
		});

		it("should emit a noop when privateServerPriceRobux is declared as undefined and current is also undefined", () => {
			expect.assertions(1);

			const desiredEntry = universeDesired({ privateServerPriceRobux: undefined });
			const currentEntry = universeCurrent({ privateServerPriceRobux: undefined });

			expect(diff([desiredEntry], [currentEntry])).toStrictEqual([
				{ key: UNIVERSE_SINGLETON_KEY, type: "noop" },
			]);
		});
	});
});
