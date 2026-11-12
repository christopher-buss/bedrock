import { describe, it } from "vitest";

import {
	badgeCurrent,
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";
import { asRobloxAssetId } from "../types/ids.ts";
import { compareLiveState, type LiveSnapshot } from "./live-state.ts";

describe(compareLiveState, () => {
	it("should compare managed metadata while ignoring fields saved Current state leaves unmanaged", ({
		expect,
	}) => {
		expect.assertions(1);

		const current = placeCurrent({ displayName: "Lobby" });
		const result = compareLiveState([current], {
			place: new Map([
				[
					asRobloxAssetId("4711"),
					{
						description: "Unmanaged description",
						displayName: "Dashboard name",
						kind: "place",
						outputs: {},
						serverSize: 100,
					},
				],
			]),
		});

		expect(result.edits).toStrictEqual([
			{
				key: "start-place",
				fields: [{ current: "Lobby", field: "displayName", live: "Dashboard name" }],
				kind: "place",
			},
		]);
	});

	it("should correlate every Kind by its Roblox ID", ({ expect }) => {
		expect.assertions(1);

		const current = [
			badgeCurrent(),
			developerProductCurrent(),
			gamePassCurrent(),
			placeCurrent(),
			universeCurrent(),
		];
		const snapshot: LiveSnapshot = {
			badge: new Map([[asRobloxAssetId("2468013579"), { kind: "badge", outputs: {} }]]),
			developerProduct: new Map([
				[asRobloxAssetId("8172635495"), { kind: "developerProduct", outputs: {} }],
			]),
			gamePass: new Map([[asRobloxAssetId("9876543210"), { kind: "gamePass", outputs: {} }]]),
			place: new Map([[asRobloxAssetId("4711"), { kind: "place", outputs: {} }]]),
			universe: new Map([[asRobloxAssetId("1234567890"), { kind: "universe", outputs: {} }]]),
		};

		expect(compareLiveState(current, snapshot)).toStrictEqual({
			edits: [],
			missing: [],
			resources: current,
		});
	});

	it("should distinguish an unreadable field from an explicit off-sale value and retain file fields", ({
		expect,
	}) => {
		expect.assertions(3);

		const current = gamePassCurrent();
		const result = compareLiveState([current], {
			gamePass: new Map([
				[
					asRobloxAssetId("9876543210"),
					{ kind: "gamePass", outputs: {}, price: undefined },
				],
			]),
		});

		expect(result.edits).toStrictEqual([
			{
				key: "vip-pass",
				fields: [{ current: 500, field: "price", live: undefined }],
				kind: "gamePass",
			},
		]);
		expect(result.resources).toStrictEqual([{ ...current, price: undefined }]);
		expect(current.price).toBe(500);
	});
});
