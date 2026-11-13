import { describe, it } from "vitest";

import { asRobloxAssetId } from "../types/ids.ts";
import { planImport } from "./import-plan.ts";
import type { LiveSnapshot, ResourceLiveState } from "./live-state.ts";
import type { Config } from "./schema.ts";

const ICON_ID = asRobloxAssetId("555");

function livePass(name: string): ResourceLiveState<"gamePass"> {
	return {
		name,
		description: "Perks.",
		isManagedPricingEnabled: false,
		kind: "gamePass",
		outputs: { iconAssetIds: { "en-us": ICON_ID } },
		price: 100,
	};
}

function passes(...entries: ReadonlyArray<readonly [string, ResourceLiveState<"gamePass">]>) {
	return {
		gamePass: new Map(entries.map(([id, live]) => [asRobloxAssetId(id), live] as const)),
	} satisfies LiveSnapshot;
}

const CONFIG: Config = {
	environments: { production: {}, staging: {} },
	universe: { universeId: "1" },
};

const VIP = asRobloxAssetId("11");

describe("planImport links", () => {
	it("should suggest the same-name item of another Environment and write its importId there", ({
		expect,
	}) => {
		expect.assertions(3);

		const input = {
			config: CONFIG,
			environment: "production",
			linkLive: {
				staging: passes(["21", livePass("Other")], ["22", livePass("[STAGING] VIP Pass")]),
			},
			live: passes(["11", livePass("[PROD] VIP Pass")]),
		};
		const offered = planImport({ ...input, selections: [{ kind: "gamePass", robloxId: VIP }] });
		const linked = planImport({
			...input,
			selections: [
				{ kind: "gamePass", links: { staging: asRobloxAssetId("22") }, robloxId: VIP },
			],
		});

		expect(offered.edits.map(({ kind }) => kind)).toStrictEqual(["addEntry", "declareImport"]);
		expect(offered.links).toMatchObject([
			{
				key: "vip-pass",
				candidates: [
					{ name: "Other", robloxId: "21" },
					{ name: "[STAGING] VIP Pass", robloxId: "22" },
				],
				environment: "staging",
				kind: "gamePass",
				linked: undefined,
				robloxId: "11",
				suggested: "22",
			},
		]);
		expect(linked.edits.filter(({ kind }) => kind === "declareImport")).toStrictEqual([
			{
				key: "vip-pass",
				collection: "passes",
				environment: "production",
				importId: "11",
				kind: "declareImport",
			},
			{
				key: "vip-pass",
				collection: "passes",
				environment: "staging",
				importId: "22",
				kind: "declareImport",
			},
		]);
	});

	it("should list the fields where each candidate differs from the written entry", ({
		expect,
	}) => {
		expect.assertions(3);

		const { description: _description, ...noDescription } = livePass("VIP");
		const plan = planImport({
			config: CONFIG,
			environment: "production",
			linkLive: {
				staging: {
					...passes(
						[
							"21",
							{
								...livePass("[STAGING] VIP"),
								isManagedPricingEnabled: true,
								outputs: { iconAssetIds: { "en-us": asRobloxAssetId("556") } },
								price: 90,
							},
						],
						["22", { ...noDescription, isManagedPricingEnabled: false }],
					),
					badge: new Map([
						[
							asRobloxAssetId("41"),
							{
								name: "Win",
								description: "Win.",
								enabled: false,
								kind: "badge",
								outputs: { iconImageId: ICON_ID },
							},
						],
					]),
					developerProduct: new Map([
						[
							asRobloxAssetId("31"),
							{
								name: "Gems",
								description: "Gems.",
								kind: "developerProduct",
								outputs: { iconImageAssetId: ICON_ID },
								price: 5,
							},
						],
					]),
				},
			},
			live: {
				...passes(["11", livePass("VIP")]),
				badge: new Map([
					[
						asRobloxAssetId("12"),
						{
							name: "Win",
							description: "Win.",
							enabled: true,
							kind: "badge",
							outputs: { iconImageId: ICON_ID },
						},
					],
				]),
				developerProduct: new Map([
					[
						asRobloxAssetId("13"),
						{
							name: "Gems",
							description: "Gems.",
							kind: "developerProduct",
							outputs: {},
							price: 5,
						},
					],
				]),
			},
			selections: [
				{ kind: "gamePass", robloxId: VIP },
				{ kind: "badge", robloxId: asRobloxAssetId("12") },
				{ kind: "developerProduct", robloxId: asRobloxAssetId("13") },
			],
		});

		expect(plan.links[0]!.candidates).toStrictEqual([
			{
				name: "[STAGING] VIP",
				differences: [
					{ config: "assets/passes/vip.png", field: "icon", live: "556" },
					{ config: false, field: "isManagedPricingEnabled", live: true },
					{ config: "VIP", field: "name", live: "[STAGING] VIP" },
					{ config: 100, field: "price", live: 90 },
				],
				robloxId: "21",
			},
			{ name: "VIP", differences: [], robloxId: "22" },
		]);
		expect(plan.links[1]!.candidates[0]!.differences).toStrictEqual([
			{ config: true, field: "enabled", live: false },
		]);
		expect(plan.links[2]!.candidates[0]!.differences).toStrictEqual([]);
	});

	it("should mark an item no other Environment can link to as not importable yet", ({
		expect,
	}) => {
		expect.assertions(3);

		const input = {
			config: CONFIG,
			environment: "production",
			live: passes(
				["11", livePass("VIP")],
				["12", livePass("Gold")],
				["13", livePass("Solo")],
			),
		};
		const staging = passes(["21", livePass("[STAGING] VIP")], ["22", livePass("Gold")]);
		const plan = planImport({
			...input,
			linkLive: { staging },
			selections: [{ kind: "gamePass", robloxId: asRobloxAssetId("13") }],
		});
		const withSpare = planImport({
			...input,
			linkLive: { staging: passes(["21", livePass("VIP")], ["23", livePass("Renamed")]) },
		});
		const unchecked = planImport({
			...input,
			config: { ...CONFIG, environments: { ...CONFIG.environments, qa: {} } },
			linkLive: { qa: {}, staging },
		});

		const refusal = {
			kind: "gamePass",
			message:
				'gamePass 13 "Solo" exists only in "production": no other Environment has a live game pass to link it to, so it cannot be imported yet.',
			reason: "onlyOneEnvironment",
			robloxId: "13",
		};

		expect(plan.items.map(({ unavailable }) => unavailable)).toStrictEqual([
			undefined,
			undefined,
			refusal,
		]);
		expect(plan.refused).toStrictEqual([refusal]);
		expect(
			[...withSpare.items, ...unchecked.items].filter(
				({ unavailable }) => unavailable !== undefined,
			),
		).toBeEmpty();
	});

	it("should link by hand to an item whose name differs", ({ expect }) => {
		expect.assertions(3);

		const plan = planImport({
			config: { ...CONFIG, environments: { ...CONFIG.environments, qa: {} } },
			environment: "production",
			linkLive: { staging: passes(["21", livePass("Renamed")], ["22", livePass("Gold")]) },
			live: passes(["11", livePass("VIP Pass")], ["12", livePass("Gold")]),
			selections: [
				{ kind: "gamePass", links: { staging: asRobloxAssetId("21") }, robloxId: VIP },
				{
					kind: "gamePass",
					links: { staging: asRobloxAssetId("22") },
					robloxId: asRobloxAssetId("12"),
				},
			],
		});

		expect(plan.refused).toBeEmpty();
		expect(plan.links).toMatchObject([
			{ linked: "21", suggested: undefined },
			{ linked: "22", suggested: "22" },
		]);
		expect(plan.edits).toMatchObject([
			{ kind: "addEntry" },
			{ environment: "production" },
			{ environment: "staging", importId: "21" },
			{ kind: "addEntry" },
			{ environment: "production" },
			{ environment: "staging", importId: "22" },
		]);
	});

	it("should refuse a link to an item that is not an untracked live item of that Environment", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: {
				...CONFIG,
				environments: {
					production: {},
					qa: {},
					staging: { passes: { old: { importId: "22" } } },
				},
			},
			environment: "production",
			linkLive: {
				production: passes(["15", livePass("Gems")]),
				staging: passes(
					["21", livePass("VIP")],
					["22", livePass("Old")],
					["23", livePass("Spare")],
				),
			},
			live: passes(
				["11", livePass("VIP")],
				["12", livePass("Gold")],
				["13", livePass("Speed")],
				["14", livePass("Coins")],
				["15", livePass("Gems")],
			),
			selections: [
				{ kind: "gamePass", links: { staging: asRobloxAssetId("21") }, robloxId: VIP },
				{
					kind: "gamePass",
					links: { staging: asRobloxAssetId("21") },
					robloxId: asRobloxAssetId("12"),
				},
				{
					kind: "gamePass",
					links: { staging: asRobloxAssetId("22") },
					robloxId: asRobloxAssetId("13"),
				},
				{
					kind: "gamePass",
					links: { qa: asRobloxAssetId("31") },
					robloxId: asRobloxAssetId("14"),
				},
				{
					kind: "gamePass",
					links: { production: asRobloxAssetId("15") },
					robloxId: asRobloxAssetId("15"),
				},
			],
		});

		expect(plan.refused).toStrictEqual([
			{
				kind: "gamePass",
				message:
					'gamePass 12 "Gold" cannot link to id 21 in "staging": another Key links to it.',
				reason: "linkUnavailable",
				robloxId: "12",
			},
			{
				kind: "gamePass",
				message:
					'gamePass 13 "Speed" cannot link to id 22 in "staging": it is not an untracked live game pass there.',
				reason: "linkUnavailable",
				robloxId: "13",
			},
			{
				kind: "gamePass",
				message:
					'gamePass 14 "Coins" cannot link to id 31 in "qa": it is not an untracked live game pass there.',
				reason: "linkUnavailable",
				robloxId: "14",
			},
			{
				kind: "gamePass",
				message:
					'gamePass 15 "Gems" cannot link to id 15 in "production": it is not an untracked live game pass there.',
				reason: "linkUnavailable",
				robloxId: "15",
			},
		]);
	});

	it("should offer no candidates where the Kind was not listed and keep unnamed candidates", ({
		expect,
	}) => {
		expect.assertions(1);

		const { name: _name, ...unnamed } = livePass("");
		const plan = planImport({
			config: { ...CONFIG, environments: { ...CONFIG.environments, qa: {} } },
			environment: "production",
			linkLive: {
				qa: {},
				staging: passes(
					["21", unnamed],
					["22", livePass("VIP")],
					["23", livePass("[QA] VIP")],
				),
			},
			live: passes(["11", livePass("VIP")], ["12", livePass("Gold")]),
			selections: [
				{ kind: "gamePass", robloxId: asRobloxAssetId("12") },
				{ kind: "gamePass", robloxId: VIP },
			],
		});

		expect(
			plan.links.map(({ candidates, environment, suggested }) => {
				return { environment, names: candidates.map(({ name }) => name), suggested };
			}),
		).toStrictEqual([
			{ environment: "staging", names: ["", "VIP", "[QA] VIP"], suggested: undefined },
			{ environment: "staging", names: ["", "VIP", "[QA] VIP"], suggested: undefined },
			{ environment: "qa", names: [], suggested: undefined },
			{ environment: "qa", names: [], suggested: undefined },
		]);
	});

	it("should treat unnamed items as one name and never mark a tracked item", ({ expect }) => {
		expect.assertions(1);

		const { name: _name, ...unnamed } = livePass("");
		const plan = planImport({
			config: {
				...CONFIG,
				environments: {
					...CONFIG.environments,
					production: { passes: { kept: { importId: "13" } } },
				},
			},
			environment: "production",
			linkLive: { staging: passes(["21", unnamed]) },
			live: passes(["11", unnamed], ["12", livePass("Solo")], ["13", livePass("Kept")]),
		});

		expect(plan.items.map(({ unavailable }) => unavailable)).toMatchObject([
			undefined,
			{ reason: "onlyOneEnvironment" },
			undefined,
		]);
	});
});
