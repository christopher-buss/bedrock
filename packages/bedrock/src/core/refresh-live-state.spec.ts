import { describe, it } from "vitest";

import {
	badgeCurrent,
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";
import {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	type BedrockState,
	type LiveSnapshot,
	refreshLiveState,
} from "../index.ts";

describe(refreshLiveState, () => {
	it("should return new State with Live values while retaining file fields, keys and bookkeeping", ({
		expect,
	}) => {
		expect.assertions(4);

		const pass = Object.freeze(gamePassCurrent());
		const place = Object.freeze(placeCurrent({ displayName: "Lobby" }));
		const state = Object.freeze<BedrockState>({
			codegenHash: asSha256Hex("a".repeat(64)),
			environment: "production",
			pendingRebuild: new Set([asResourceKey("start-place")]),
			realDisplay: { "gamePass:vip-pass": { name: "Private name" } },
			resources: Object.freeze([pass, place]),
			universeVisibility: { status: "intent", target: "private", universeId: "123" },
			version: 1,
		});
		const refreshed = refreshLiveState(state, {
			gamePass: new Map([
				[pass.outputs.assetId, { kind: "gamePass", outputs: {}, price: undefined }],
			]),
			place: new Map([
				[place.placeId, { displayName: "Live lobby", kind: "place", outputs: {} }],
			]),
		});

		expect(refreshed).toStrictEqual({
			codegenHash: "a".repeat(64),
			environment: "production",
			pendingRebuild: new Set(["start-place"]),
			realDisplay: { "gamePass:vip-pass": { name: "Private name" } },
			resources: [
				{ ...pass, price: undefined },
				{ ...place, displayName: "Live lobby" },
			],
			universeVisibility: { status: "intent", target: "private", universeId: "123" },
			version: 1,
		});
		expect(refreshed).not.toBe(state);
		expect(state.resources).toStrictEqual([pass, place]);
		expect([pass.price, place.displayName]).toStrictEqual([500, "Lobby"]);
	});

	it("should retain unchecked and missing resources without importing extra Live items", ({
		expect,
	}) => {
		expect.assertions(3);

		const state: BedrockState = {
			environment: "staging",
			resources: [gamePassCurrent(), badgeCurrent()],
			version: 1,
		};
		const refreshed = refreshLiveState(state, {
			badge: new Map(),
			developerProduct: new Map([
				[
					asRobloxAssetId("999"),
					{ name: "Untracked", kind: "developerProduct", outputs: {} },
				],
			]),
		});

		expect(refreshed).toStrictEqual(state);
		expect(refreshed).not.toBe(state);
		expect(refreshed.resources).not.toBe(state.resources);
	});

	it("should refresh each Kind by Roblox ID while preserving shared config Keys and unreadable Outputs", ({
		expect,
	}) => {
		expect.assertions(2);

		const key = asResourceKey("shared-key");
		const badge = badgeCurrent({ key });
		const product = developerProductCurrent({ key });
		const pass = gamePassCurrent({ key });
		const place = placeCurrent({ key });
		const universe = universeCurrent({ key });
		const state: BedrockState = {
			environment: "production",
			resources: [badge, product, pass, place, universe],
			version: 1,
		};
		const snapshot: LiveSnapshot = {
			badge: new Map([
				[
					badge.outputs.badgeId,
					{
						enabled: false,
						kind: "badge",
						outputs: { iconImageId: asRobloxAssetId("10") },
					},
				],
			]),
			developerProduct: new Map([
				[
					product.outputs.productId,
					{
						kind: "developerProduct",
						outputs: {},
						price: 120,
					},
				],
			]),
			gamePass: new Map([
				[pass.outputs.assetId, { kind: "gamePass", outputs: {}, price: 200 }],
			]),
			place: new Map([[place.placeId, { kind: "place", outputs: {}, serverSize: 20 }]]),
			universe: new Map([
				[universe.universeId, { kind: "universe", outputs: {}, voiceChatEnabled: false }],
			]),
		};

		expect(refreshLiveState(state, snapshot).resources).toStrictEqual([
			{ ...badge, enabled: false, outputs: { badgeId: "2468013579", iconImageId: "10" } },
			{ ...product, price: 120 },
			{ ...pass, price: 200 },
			{ ...place, serverSize: 20 },
			{ ...universe, voiceChatEnabled: false },
		]);
		expect(badge.outputs.iconImageId).toBe("1357924680");
	});

	it("should retain absent fields and accept explicit undefined in fields and Outputs without mutating Live values", ({
		expect,
	}) => {
		expect.assertions(3);

		const product = developerProductCurrent({
			outputs: {
				iconImageAssetId: asRobloxAssetId("456"),
				productId: asRobloxAssetId("123"),
			},
			price: 100,
		});
		const live = Object.freeze({
			kind: "developerProduct" as const,
			outputs: Object.freeze({ iconImageAssetId: undefined }),
			price: undefined,
		});
		const state: BedrockState = { environment: "production", resources: [product], version: 1 };
		const refreshed = refreshLiveState(state, {
			developerProduct: new Map([[product.outputs.productId, live]]),
		});

		expect(refreshed.resources).toStrictEqual([
			{
				...product,
				outputs: { iconImageAssetId: undefined, productId: "123" },
				price: undefined,
			},
		]);
		expect(product.outputs).toStrictEqual({ iconImageAssetId: "456", productId: "123" });
		expect(live).toStrictEqual({
			kind: "developerProduct",
			outputs: { iconImageAssetId: undefined },
			price: undefined,
		});
	});

	it("should retain absence of optional State metadata when refreshing empty State", ({
		expect,
	}) => {
		expect.assertions(2);

		const state: BedrockState = { environment: "production", resources: [], version: 1 };
		const refreshed = refreshLiveState(state, {});

		expect(refreshed).toStrictEqual({ environment: "production", resources: [], version: 1 });
		expect(refreshed).not.toBe(state);
	});
});
