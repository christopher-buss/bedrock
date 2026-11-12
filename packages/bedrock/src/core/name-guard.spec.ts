import { assert, describe, it } from "vitest";

import {
	badgeCurrent,
	badgeDesired,
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
	placeDesired,
} from "#tests/helpers/resources";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import type { LiveSnapshot, ResourceLiveState } from "./live-state.ts";
import { guardCreatesByName } from "./name-guard.ts";
import type { Operation } from "./operations.ts";

const PASS_ID = asRobloxAssetId("111");

function livePass(name: string): ResourceLiveState<"gamePass"> {
	return { name, kind: "gamePass", outputs: {} };
}

function createPass(name = "VIP Pass"): Operation {
	return { key: asResourceKey("vip-pass"), desired: gamePassDesired({ name }), type: "create" };
}

describe(guardCreatesByName, () => {
	it("should refuse a create whose name matches an untracked live item and print its importId line", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = guardCreatesByName({
			environment: "production",
			ops: [createPass()],
			resources: [],
			snapshot: { gamePass: new Map([[PASS_ID, livePass("VIP Pass")]]) },
		});

		expect(result.success).toBe(false);
		expect(result).toStrictEqual({
			err: {
				kind: "untrackedNameMatch",
				matches: [{ key: "vip-pass", kind: "gamePass", robloxId: "111" }],
				message: [
					"A planned create has the name of a live item that no Key tracks. Add the importId line to take the item over, or rename the entry:",
					'  gamePass:vip-pass matches "VIP Pass" (id 111): environments.production.passes.vip-pass.importId "111"',
				].join("\n"),
			},
			success: false,
		});
	});

	it("should match a live name after its display-name prefix is removed", ({ expect }) => {
		expect.assertions(1);

		const result = guardCreatesByName({
			environment: "production",
			ops: [createPass()],
			resources: [],
			snapshot: { gamePass: new Map([[PASS_ID, livePass("[PROD] VIP Pass")]]) },
		});

		expect(result.success).toBe(false);
	});

	it("should name the products and badges collections in the importId line", ({ expect }) => {
		expect.assertions(1);

		const result = guardCreatesByName({
			environment: "staging",
			ops: [
				{ key: asResourceKey("coins"), desired: developerProductDesired(), type: "create" },
				{ key: asResourceKey("winner"), desired: badgeDesired(), type: "create" },
			],
			resources: [],
			snapshot: {
				badge: new Map([
					[
						asRobloxAssetId("3"),
						{ name: badgeDesired().name, kind: "badge", outputs: {} },
					],
				]),
				developerProduct: new Map([
					[
						asRobloxAssetId("2"),
						{
							name: developerProductDesired().name,
							kind: "developerProduct",
							outputs: {},
						},
					],
				]),
			},
		});

		assert(!result.success);

		expect(result.err.message.split("\n").slice(1)).toStrictEqual([
			`  developerProduct:coins matches "${developerProductDesired().name}" (id 2): environments.staging.products.coins.importId "2"`,
			`  badge:winner matches "${badgeDesired().name}" (id 3): environments.staging.badges.winner.importId "3"`,
		]);
	});

	it("should allow a create whose same-named live item another Key tracks", ({ expect }) => {
		expect.assertions(1);

		const result = guardCreatesByName({
			environment: "production",
			ops: [createPass()],
			resources: [
				gamePassCurrent({
					key: asResourceKey("old-pass"),
					outputs: { assetId: PASS_ID, iconAssetIds: { "en-us": asRobloxAssetId("5") } },
				}),
				badgeCurrent(),
			],
			snapshot: { gamePass: new Map([[PASS_ID, livePass("VIP Pass")]]) },
		});

		expect(result).toStrictEqual({ data: undefined, success: true });
	});

	it("should allow creates the live check did not list, renamed, or of other Kinds", ({
		expect,
	}) => {
		expect.assertions(1);

		const snapshot: LiveSnapshot = {
			gamePass: new Map([[PASS_ID, livePass("Other Pass")]]),
			place: new Map(),
		};
		const result = guardCreatesByName({
			environment: "production",
			ops: [
				createPass(),
				{ key: asResourceKey("coins"), desired: developerProductDesired(), type: "create" },
				{ key: asResourceKey("start"), desired: placeDesired(), type: "create" },
				{
					key: asResourceKey("old-pass"),
					current: gamePassCurrent({ name: "Other Pass" }),
					type: "untrack",
				},
			],
			resources: [],
			snapshot,
		});

		expect(result).toStrictEqual({ data: undefined, success: true });
	});
});
