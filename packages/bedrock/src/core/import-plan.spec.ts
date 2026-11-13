import { describe, it } from "vitest";

import { developerProductCurrent, gamePassCurrent } from "#tests/helpers/resources";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { planImport } from "./import-plan.ts";
import type { LiveSnapshot, ResourceLiveState } from "./live-state.ts";
import type { Config } from "./schema.ts";

const ICON_ID = asRobloxAssetId("555");

function livePass(name: string, icon = true): ResourceLiveState<"gamePass"> {
	return {
		name,
		description: "Perks.",
		isManagedPricingEnabled: false,
		kind: "gamePass",
		outputs: { iconAssetIds: icon ? { "en-us": ICON_ID } : undefined },
		price: 100,
	};
}

function passes(...entries: ReadonlyArray<readonly [string, ResourceLiveState<"gamePass">]>) {
	return {
		gamePass: new Map(entries.map(([id, live]) => [asRobloxAssetId(id), live] as const)),
	} satisfies LiveSnapshot;
}

const CONFIG: Config = {
	environments: { production: {} },
	universe: { universeId: "1" },
};

describe(planImport, () => {
	it("should suggest the kebab-cased name without its display-name prefix as the Key", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: passes(
				["11", livePass("[PROD] VIP Pass")],
				["12", livePass("Double Coins!")],
				["13", livePass("SpeedBoost")],
			),
		});

		expect(plan.items.map(({ key, name }) => ({ key, name }))).toStrictEqual([
			{ key: "vip-pass", name: "[PROD] VIP Pass" },
			{ key: "double-coins", name: "Double Coins!" },
			{ key: "speed-boost", name: "SpeedBoost" },
		]);
	});

	it("should add a numbered suffix when the Key is taken by config, State or another item", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: {
				...CONFIG,
				passes: {
					vip: { name: "VIP", description: "", icon: { "en-us": "vip.png" } },
				},
			},
			environment: "production",
			live: passes(
				["11", livePass("VIP")],
				["12", livePass("Speed")],
				["13", livePass("Speed")],
			),
			states: {
				production: undefined,
				staging: {
					environment: "staging",
					resources: [
						gamePassCurrent({ key: asResourceKey("speed") }),
						developerProductCurrent({ key: asResourceKey("vip-2") }),
					],
					version: 1,
				},
			},
		});

		expect(plan.items.map(({ key }) => key)).toStrictEqual(["vip-2", "speed-2", "speed-3"]);
	});

	it("should fall back to the Kind and id when the name has no letters or digits", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: passes(["11", livePass("★★★")]),
		});

		expect(plan.items[0]!.key).toBe("game-pass-11");
	});

	it("should mark an item the Environment already tracks with the tracking Key", ({ expect }) => {
		expect.assertions(1);

		const plan = planImport({
			config: {
				...CONFIG,
				environments: {
					production: {
						passes: { declared: { importId: "12" } },
						products: { gems: { importId: "13" } },
					},
				},
			},
			environment: "production",
			live: passes(
				["11", livePass("VIP")],
				["12", livePass("Speed")],
				["13", livePass("New")],
				["14", livePass("Other")],
			),
			states: {
				production: {
					environment: "production",
					resources: [
						gamePassCurrent({
							key: asResourceKey("old-vip"),
							outputs: {
								assetId: asRobloxAssetId("11"),
								iconAssetIds: { "en-us": ICON_ID },
							},
						}),
						developerProductCurrent({
							key: asResourceKey("coins"),
							outputs: { productId: asRobloxAssetId("14") },
						}),
					],
					version: 1,
				},
			},
		});

		expect(
			plan.items.map(({ key, robloxId, trackedBy }) => {
				return { key, robloxId, trackedBy };
			}),
		).toStrictEqual([
			{ key: "old-vip", robloxId: "11", trackedBy: "old-vip" },
			{ key: "declared", robloxId: "12", trackedBy: "declared" },
			{ key: "new", robloxId: "13", trackedBy: undefined },
			{ key: "other", robloxId: "14", trackedBy: undefined },
		]);
	});

	it("should suggest a repository path for the stored icon and none for the default image", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: passes(["11", livePass("VIP")], ["12", livePass("Plain", false)]),
		});

		expect(plan.items.map(({ icon }) => icon)).toStrictEqual([
			{ assetId: ICON_ID, path: "assets/passes/vip.png" },
			undefined,
		]);
	});

	it("should add a root entry with live values and an importId line for a selected pass", ({
		expect,
	}) => {
		expect.assertions(2);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: passes(["11", livePass("VIP Pass")]),
			selections: [{ kind: "gamePass", robloxId: asRobloxAssetId("11") }],
		});

		expect(plan.edits).toStrictEqual([
			{
				key: "vip-pass",
				collection: "passes",
				entry: {
					name: "VIP Pass",
					description: "Perks.",
					icon: { "en-us": "assets/passes/vip-pass.png" },
					price: 100,
				},
				kind: "addEntry",
			},
			{
				key: "vip-pass",
				collection: "passes",
				environment: "production",
				importId: "11",
				kind: "declareImport",
			},
		]);
		expect(plan.refused).toBeEmpty();
	});

	it("should declare iconBaseline when the icon is the user's own file", ({ expect }) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: passes(["11", livePass("VIP")]),
			selections: [
				{
					key: "gold",
					icon: { path: "art/gold.png", source: "userFile" },
					kind: "gamePass",
					robloxId: asRobloxAssetId("11"),
				},
			],
		});

		expect(plan.edits).toStrictEqual([
			{
				key: "gold",
				collection: "passes",
				entry: {
					name: "VIP",
					description: "Perks.",
					icon: { "en-us": "art/gold.png" },
					price: 100,
				},
				kind: "addEntry",
			},
			{
				key: "gold",
				collection: "passes",
				environment: "production",
				iconBaseline: "accept-local-file",
				importId: "11",
				kind: "declareImport",
			},
		]);
	});

	it("should write managed pricing and leave the price out of an off-sale product without an icon", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: {
				developerProduct: new Map([
					[
						asRobloxAssetId("21"),
						{
							name: "Gems",
							description: "Shiny.",
							isManagedPricingEnabled: false,
							kind: "developerProduct",
							outputs: { iconImageAssetId: undefined },
							price: undefined,
						},
					],
					[
						asRobloxAssetId("22"),
						{
							name: "Coins",
							description: "Gold.",
							isManagedPricingEnabled: true,
							kind: "developerProduct",
							outputs: { iconImageAssetId: ICON_ID },
							price: 50,
						},
					],
				]),
			},
			selections: [
				{ kind: "developerProduct", robloxId: asRobloxAssetId("21") },
				{ kind: "developerProduct", robloxId: asRobloxAssetId("22") },
			],
		});

		expect(plan.edits.filter(({ kind }) => kind === "addEntry")).toStrictEqual([
			{
				key: "gems",
				collection: "products",
				entry: { name: "Gems", description: "Shiny." },
				kind: "addEntry",
			},
			{
				key: "coins",
				collection: "products",
				entry: {
					name: "Coins",
					description: "Gold.",
					icon: { "en-us": "assets/products/coins.png" },
					isManagedPricingEnabled: true,
					price: 50,
				},
				kind: "addEntry",
			},
		]);
	});

	it("should write empty text for a name or description Roblox did not return", ({ expect }) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: {
				developerProduct: new Map([
					[asRobloxAssetId("21"), { kind: "developerProduct", outputs: {} }],
				]),
			},
			selections: [{ kind: "developerProduct", robloxId: asRobloxAssetId("21") }],
		});

		expect(plan.edits[0]).toStrictEqual({
			key: "developer-product-21",
			collection: "products",
			entry: { name: "", description: "" },
			kind: "addEntry",
		});
	});

	it("should write enabled only for a disabled badge", ({ expect }) => {
		expect.assertions(1);

		function badge(name: string, enabled: boolean): ResourceLiveState<"badge"> {
			return {
				name,
				description: "Won.",
				enabled,
				kind: "badge",
				outputs: { iconImageId: ICON_ID },
			};
		}

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: {
				badge: new Map([
					[asRobloxAssetId("31"), badge("Winner", true)],
					[asRobloxAssetId("32"), badge("Loser", false)],
				]),
			},
			selections: [
				{ kind: "badge", robloxId: asRobloxAssetId("31") },
				{ kind: "badge", robloxId: asRobloxAssetId("32") },
			],
		});

		expect(plan.edits.filter(({ kind }) => kind === "addEntry")).toStrictEqual([
			{
				key: "winner",
				collection: "badges",
				entry: {
					name: "Winner",
					description: "Won.",
					icon: { "en-us": "assets/badges/winner.png" },
				},
				kind: "addEntry",
			},
			{
				key: "loser",
				collection: "badges",
				entry: {
					name: "Loser",
					description: "Won.",
					enabled: false,
					icon: { "en-us": "assets/badges/loser.png" },
				},
				kind: "addEntry",
			},
		]);
	});

	it("should refuse a selection that is not live, tracked, on the default image or under a bad Key", ({
		expect,
	}) => {
		expect.assertions(2);

		const plan = planImport({
			config: {
				...CONFIG,
				environments: { production: { passes: { speed: { importId: "12" } } } },
				passes: { vip: { name: "VIP", description: "", icon: { "en-us": "vip.png" } } },
			},
			environment: "production",
			live: passes(
				["11", livePass("VIP")],
				["12", livePass("Speed")],
				["13", livePass("Plain", false)],
			),
			selections: [
				{ kind: "gamePass", robloxId: asRobloxAssetId("99") },
				{ kind: "badge", robloxId: asRobloxAssetId("11") },
				{ kind: "gamePass", robloxId: asRobloxAssetId("12") },
				{ kind: "gamePass", robloxId: asRobloxAssetId("13") },
				{ key: "vip", kind: "gamePass", robloxId: asRobloxAssetId("11") },
				{ key: "not a key", kind: "gamePass", robloxId: asRobloxAssetId("11") },
			],
		});

		expect(plan.edits).toBeEmpty();
		expect(plan.refused).toStrictEqual([
			{
				kind: "gamePass",
				message: 'gamePass 99 is not a live game pass in "production".',
				reason: "notLive",
				robloxId: "99",
			},
			{
				kind: "badge",
				message: 'badge 11 is not a live badge in "production".',
				reason: "notLive",
				robloxId: "11",
			},
			{
				kind: "gamePass",
				message: "gamePass 12 \"Speed\" is already tracked by 'speed'.",
				reason: "tracked",
				robloxId: "12",
			},
			{
				kind: "gamePass",
				message:
					'gamePass 13 "Plain" uses the Roblox default image. Give it an icon on Roblox, then import it.',
				reason: "defaultImage",
				robloxId: "13",
			},
			{
				kind: "gamePass",
				message: "gamePass 11 \"VIP\" cannot use the Key 'vip': it is already in use.",
				reason: "keyTaken",
				robloxId: "11",
			},
			{
				kind: "gamePass",
				message:
					"gamePass 11 \"VIP\" cannot use the Key 'not a key': use letters, digits, - and _ only.",
				reason: "invalidKey",
				robloxId: "11",
			},
		]);
	});

	it("should retire the root entry of a cleared tracked item and skip an untracked one", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: {
				...passes(["11", livePass("VIP")], ["12", livePass("Speed")]),
				developerProduct: new Map([
					[
						asRobloxAssetId("14"),
						{
							name: "Coins",
							description: "",
							isManagedPricingEnabled: false,
							kind: "developerProduct",
							outputs: {},
						},
					],
				]),
			},
			selections: [{ kind: "gamePass", robloxId: asRobloxAssetId("12") }],
			states: {
				production: {
					environment: "production",
					resources: [
						gamePassCurrent({
							key: asResourceKey("old-vip"),
							outputs: {
								assetId: asRobloxAssetId("11"),
								iconAssetIds: { "en-us": ICON_ID },
							},
						}),
						developerProductCurrent({
							key: asResourceKey("coins"),
							outputs: { productId: asRobloxAssetId("14") },
						}),
					],
					version: 1,
				},
			},
			untrack: [
				{ kind: "developerProduct", robloxId: asRobloxAssetId("14") },
				{ kind: "gamePass", robloxId: asRobloxAssetId("12") },
				{ kind: "gamePass", robloxId: asRobloxAssetId("99") },
				{ kind: "badge", robloxId: asRobloxAssetId("11") },
				{ kind: "gamePass", robloxId: asRobloxAssetId("11") },
			],
		});

		expect(plan.edits.filter(({ kind }) => kind !== "addEntry")).toStrictEqual([
			{
				key: "speed",
				collection: "passes",
				environment: "production",
				importId: "12",
				kind: "declareImport",
			},
			{ key: "coins", collection: "products", kind: "untrack" },
			{ key: "old-vip", collection: "passes", kind: "untrack" },
		]);
	});

	it("should keep two selections from sharing one chosen Key", ({ expect }) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: passes(["11", livePass("VIP")], ["12", livePass("Gold")]),
			selections: [
				{ key: "gold", kind: "gamePass", robloxId: asRobloxAssetId("11") },
				{ kind: "gamePass", robloxId: asRobloxAssetId("12") },
			],
		});

		expect(plan.refused.map(({ reason, robloxId }) => [reason, robloxId])).toStrictEqual([
			["keyTaken", "12"],
		]);
	});

	it("should refuse a badge that uses the Roblox default image", ({ expect }) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: {
				badge: new Map([
					[
						asRobloxAssetId("11"),
						{ name: "Winner", kind: "badge", outputs: { iconImageId: undefined } },
					],
				]),
			},
			selections: [{ kind: "badge", robloxId: asRobloxAssetId("11") }],
		});

		expect(plan.refused.map(({ reason }) => reason)).toStrictEqual(["defaultImage"]);
	});
});
