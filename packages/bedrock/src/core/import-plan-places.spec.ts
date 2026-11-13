import { describe, it } from "vitest";

import { placeCurrent } from "#tests/helpers/resources";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { planImport } from "./import-plan.ts";
import type { LiveSnapshot, ResourceLiveState } from "./live-state.ts";
import type { Config } from "./schema.ts";

function livePlace(
	displayName: string,
	overrides: Partial<ResourceLiveState<"place">> = {},
): ResourceLiveState<"place"> {
	return {
		description: "A place.",
		displayName,
		kind: "place",
		outputs: {},
		serverSize: 30,
		...overrides,
	};
}

function places(
	entries: ReadonlyArray<readonly [string, ResourceLiveState<"place">]>,
	rootPlaceId?: string,
): LiveSnapshot {
	return {
		place: new Map(entries.map(([id, live]) => [asRobloxAssetId(id), live] as const)),
		...(rootPlaceId === undefined
			? {}
			: {
					universe: new Map([
						[
							asRobloxAssetId("1"),
							{
								kind: "universe",
								outputs: { rootPlaceId: asRobloxAssetId(rootPlaceId) },
							},
						],
					]),
				}),
	};
}

const CONFIG: Config = {
	environments: { production: { label: "prod" }, staging: { label: "staging" } },
	universe: { universeId: "1" },
};

const ONE_ENVIRONMENT: Config = {
	environments: { production: { label: "prod" } },
	universe: { universeId: "1" },
};

const LOBBY = asRobloxAssetId("11");

describe("planImport places", () => {
	it("should list each place by display name, with no icon, and mark the root place", ({
		expect,
	}) => {
		expect.assertions(2);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: {
				...places(
					[
						["11", livePlace("[PROD] Lobby")],
						["12", livePlace("Arena")],
					],
					"11",
				),
				gamePass: new Map([
					[LOBBY, { name: "Pass", description: "", kind: "gamePass", outputs: {} }],
				]),
			},
		});

		expect(plan.items.filter(({ kind }) => kind === "place")).toStrictEqual([
			{
				key: "lobby",
				name: "[PROD] Lobby",
				icon: undefined,
				kind: "place",
				robloxId: "11",
				root: true,
				trackedBy: undefined,
			},
			{
				key: "arena",
				name: "Arena",
				icon: undefined,
				kind: "place",
				robloxId: "12",
				trackedBy: undefined,
			},
		]);
		expect(plan.items[0]).not.toHaveProperty("root");
	});

	it("should mark a place redacted, and keep its name, where the Environment redacts", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: { ...ONE_ENVIRONMENT, environments: { production: { redacted: true } } },
			environment: "production",
			live: places([["11", livePlace("Lobby")]]),
			selections: [{ kind: "place", robloxId: LOBBY }],
		});

		expect(plan).toMatchObject({
			items: [{ name: "Lobby", kind: "place", redacted: true }],
			refused: [],
		});
	});

	it("should write a config-only root entry without the Environment's prefix and a placeId line", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: ONE_ENVIRONMENT,
			environment: "production",
			live: places([
				["11", livePlace("[PROD] Lobby", { description: "", serverSize: 50 })],
				["12", livePlace("Arena", { serverSize: undefined })],
			]),
			selections: [
				{ kind: "place", robloxId: LOBBY },
				{ kind: "place", robloxId: asRobloxAssetId("12") },
			],
		});

		expect(plan.edits).toStrictEqual([
			{
				key: "lobby",
				collection: "places",
				entry: { description: "", displayName: "Lobby", serverSize: 50 },
				kind: "addEntry",
			},
			{ key: "lobby", environment: "production", kind: "declarePlaceId", placeId: "11" },
			{
				key: "arena",
				collection: "places",
				entry: { description: "A place.", displayName: "Arena" },
				kind: "addEntry",
			},
			{ key: "arena", environment: "production", kind: "declarePlaceId", placeId: "12" },
		]);
	});

	it("should treat a place as tracked by a placeId line or State, and take config Keys", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: {
				...CONFIG,
				environments: {
					...CONFIG.environments,
					production: { places: { old: { retired: true }, start: { placeId: "11" } } },
				},
				places: { arena: { displayName: "Arena" }, start: { displayName: "Lobby" } },
			},
			environment: "production",
			live: {
				...places([
					["11", livePlace("Lobby")],
					["12", livePlace("Hub")],
					["13", livePlace("Arena")],
				]),
				gamePass: new Map([
					[LOBBY, { name: "Pass", description: "", kind: "gamePass", outputs: {} }],
				]),
			},
			states: {
				production: {
					environment: "production",
					resources: [
						placeCurrent({
							key: asResourceKey("hub-place"),
							placeId: asRobloxAssetId("12"),
						}),
					],
					version: 1,
				},
			},
		});

		expect(plan.items.map(({ key, trackedBy }) => ({ key, trackedBy }))).toStrictEqual([
			{ key: "pass", trackedBy: undefined },
			{ key: "start", trackedBy: "start" },
			{ key: "hub-place", trackedBy: "hub-place" },
			{ key: "arena-2", trackedBy: undefined },
		]);
	});

	it("should keep an unprefixed display name and fill absent fields when the Environment adds no prefix", ({
		expect,
	}) => {
		expect.assertions(3);

		const plan = planImport({
			config: { ...ONE_ENVIRONMENT, displayNamePrefix: { enabled: false } },
			environment: "production",
			live: {
				...places([
					[
						"11",
						livePlace("[PROD] Lobby", {
							description: undefined,
							serverSize: undefined,
						}),
					],
					["12", livePlace("", { displayName: undefined })],
				]),
				universe: new Map([[asRobloxAssetId("1"), { kind: "universe", outputs: {} }]]),
			},
			selections: [
				{ kind: "place", robloxId: LOBBY },
				{ kind: "place", robloxId: asRobloxAssetId("12") },
			],
		});

		expect(plan.items.map(({ key, root }) => ({ key, root }))).toStrictEqual([
			{ key: "lobby", root: undefined },
			{ key: "place-12", root: undefined },
		]);
		expect(plan.edits[0]).toStrictEqual({
			key: "lobby",
			collection: "places",
			entry: { description: "", displayName: "[PROD] Lobby" },
			kind: "addEntry",
		});
		expect(plan.edits[2]).toMatchObject({ entry: { displayName: "" } });
	});

	it("should compare a linked place's display name without a prefix where the Environment adds none", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: {
				environments: { production: { label: "prod" }, staging: {} },
				universe: { universeId: "1" },
			},
			environment: "production",
			linkLive: { staging: places([["21", livePlace("Lobby")]]) },
			live: places([["11", livePlace("[PROD] Lobby")]]),
			selections: [
				{ kind: "place", links: { staging: asRobloxAssetId("21") }, robloxId: LOBBY },
			],
		});

		expect(plan.links[0]!.candidates).toStrictEqual([
			{ name: "Lobby", differences: [], robloxId: "21" },
		]);
	});

	it("should refuse a place that is not live with the place Kind name", ({ expect }) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			live: places([]),
			selections: [{ kind: "place", robloxId: LOBBY }],
		});

		expect(plan.refused).toStrictEqual([
			{
				kind: "place",
				message: 'place 11 is not a live place in "production".',
				reason: "notLive",
				robloxId: "11",
			},
		]);
	});

	it("should refuse a place left unlinked in another Environment", ({ expect }) => {
		expect.assertions(1);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			linkLive: { staging: places([["21", livePlace("Lobby")]]) },
			live: places([["11", livePlace("Lobby")]]),
			selections: [{ kind: "place", robloxId: LOBBY }],
		});

		expect(plan).toMatchObject({
			edits: [],
			links: [{ environment: "staging", linked: undefined, suggested: "21" }],
			refused: [
				{
					kind: "place",
					message:
						'place 11 "Lobby" needs a link in "staging": a place entry needs a placeId in every Environment.',
					reason: "placeNotLinked",
					robloxId: "11",
				},
			],
		});
	});

	it("should link a place by name and compare the linked Environment's prefixed display name", ({
		expect,
	}) => {
		expect.assertions(2);

		const plan = planImport({
			config: CONFIG,
			environment: "production",
			linkLive: {
				staging: places([
					["21", livePlace("[STAGING] Lobby", { serverSize: 20 })],
					["22", livePlace("Lobby")],
				]),
			},
			live: places([["11", livePlace("[PROD] Lobby")]]),
			selections: [
				{ kind: "place", links: { staging: asRobloxAssetId("21") }, robloxId: LOBBY },
			],
		});

		expect(plan.links).toStrictEqual([
			{
				key: "lobby",
				candidates: [
					{
						name: "[STAGING] Lobby",
						differences: [{ config: 30, field: "serverSize", live: 20 }],
						robloxId: "21",
					},
					{
						name: "Lobby",
						differences: [
							{ config: "[STAGING] Lobby", field: "displayName", live: "Lobby" },
						],
						robloxId: "22",
					},
				],
				environment: "staging",
				kind: "place",
				linked: "21",
				robloxId: "11",
				suggested: undefined,
			},
		]);
		expect(plan.edits.at(-1)).toStrictEqual({
			key: "lobby",
			environment: "staging",
			kind: "declarePlaceId",
			placeId: "21",
		});
	});
});
