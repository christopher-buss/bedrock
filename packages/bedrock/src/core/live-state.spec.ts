import { describe, it } from "vitest";

import {
	badgeCurrent,
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";
import { asResourceKey, asRobloxAssetId, compareLiveState, type LiveSnapshot } from "../index.ts";

describe(compareLiveState, () => {
	it("should report readable absent icons while retaining required last-known IDs in refreshed State", ({
		expect,
	}) => {
		expect.hasAssertions();

		const pass = gamePassCurrent();
		const badge = badgeCurrent();
		const result = compareLiveState([pass, badge], {
			badge: new Map([
				[badge.outputs.badgeId, { kind: "badge", outputs: { iconImageId: undefined } }],
			]),
			gamePass: new Map([
				[pass.outputs.assetId, { kind: "gamePass", outputs: { iconAssetIds: undefined } }],
			]),
		});

		expect(result.edits).toStrictEqual([
			{
				key: pass.key,
				fields: [{ current: "1122334455", field: "icon", live: undefined }],
				kind: "gamePass",
			},
			{
				key: badge.key,
				fields: [{ current: "1357924680", field: "icon", live: undefined }],
				kind: "badge",
			},
		]);
		expect(result.resources).toStrictEqual([pass, badge]);
	});

	it("should ignore unreadable icons, unknown baselines, unmanaged icons and unrelated Outputs", ({
		expect,
	}) => {
		expect.hasAssertions();

		const pass = gamePassCurrent();
		const badge = badgeCurrent();
		const unmanaged = developerProductCurrent({
			outputs: {
				iconImageAssetId: asRobloxAssetId("55"),
				productId: asRobloxAssetId("8172635495"),
			},
		});
		const unknown = developerProductCurrent({
			key: asResourceKey("unknown"),
			icon: pass.icon,
			iconFileHashes: pass.iconFileHashes,
			outputs: { productId: asRobloxAssetId("44") },
		});
		const universe = universeCurrent();
		const result = compareLiveState([pass, badge, unmanaged, unknown, universe], {
			badge: new Map([
				[
					badge.outputs.badgeId,
					{ kind: "badge", outputs: { badgeId: asRobloxAssetId("778") } },
				],
			]),
			developerProduct: new Map([
				[
					unknown.outputs.productId,
					{
						kind: "developerProduct",
						outputs: { iconImageAssetId: asRobloxAssetId("99") },
					},
				],
				[
					unmanaged.outputs.productId,
					{
						kind: "developerProduct",
						outputs: { iconImageAssetId: asRobloxAssetId("99") },
					},
				],
			]),
			gamePass: new Map([
				[
					pass.outputs.assetId,
					{ kind: "gamePass", outputs: { assetId: asRobloxAssetId("777") } },
				],
			]),
			universe: new Map([
				[
					universe.universeId,
					{ kind: "universe", outputs: { rootPlaceId: asRobloxAssetId("779") } },
				],
			]),
		});

		expect(result.edits).toStrictEqual([]);
		expect(result.missing).toStrictEqual([]);
	});

	it("should leave unchanged managed icons alone", ({ expect }) => {
		expect.hasAssertions();

		const pass = gamePassCurrent();
		const product = developerProductCurrent({
			icon: pass.icon,
			outputs: { iconImageAssetId: asRobloxAssetId("23"), productId: asRobloxAssetId("22") },
		});
		const badge = badgeCurrent();

		expect(
			compareLiveState([pass, product, badge], {
				badge: new Map([
					[badge.outputs.badgeId, { kind: "badge", outputs: badge.outputs }],
				]),
				developerProduct: new Map([
					[
						product.outputs.productId,
						{ kind: "developerProduct", outputs: product.outputs },
					],
				]),
				gamePass: new Map([
					[pass.outputs.assetId, { kind: "gamePass", outputs: pass.outputs }],
				]),
			}).edits,
		).toStrictEqual([]);
	});

	it("should compare managed source-language icon IDs before refreshing Outputs", ({
		expect,
	}) => {
		expect.hasAssertions();

		const pass = gamePassCurrent();
		const product = developerProductCurrent({
			icon: pass.icon,
			iconFileHashes: pass.iconFileHashes,
			outputs: {
				iconImageAssetId: asRobloxAssetId("22"),
				productId: asRobloxAssetId("8172635495"),
			},
		});
		const badge = badgeCurrent();
		const result = compareLiveState([pass, product, badge], {
			badge: new Map([
				[
					badge.outputs.badgeId,
					{ kind: "badge", outputs: { iconImageId: asRobloxAssetId("88") } },
				],
			]),
			developerProduct: new Map([
				[
					product.outputs.productId,
					{ kind: "developerProduct", outputs: { iconImageAssetId: undefined } },
				],
			]),
			gamePass: new Map([
				[
					pass.outputs.assetId,
					{
						kind: "gamePass",
						outputs: { iconAssetIds: { "en-us": asRobloxAssetId("99") } },
					},
				],
			]),
		});

		expect(result.edits).toStrictEqual([
			{
				key: pass.key,
				fields: [{ current: "1122334455", field: "icon", live: "99" }],
				kind: "gamePass",
			},
			{
				key: product.key,
				fields: [{ current: "22", field: "icon", live: undefined }],
				kind: "developerProduct",
			},
			{
				key: badge.key,
				fields: [{ current: "1357924680", field: "icon", live: "88" }],
				kind: "badge",
			},
		]);
		expect(result.resources).toStrictEqual([
			{ ...pass, outputs: { ...pass.outputs, iconAssetIds: { "en-us": "99" } } },
			{ ...product, outputs: { ...product.outputs, iconImageAssetId: undefined } },
			{ ...badge, outputs: { ...badge.outputs, iconImageId: "88" } },
		]);
		expect(pass.outputs.iconAssetIds["en-us"]).toBe("1122334455");
	});

	it("should distinguish unchecked Kinds from missing resources without importing untracked items", ({
		expect,
	}) => {
		expect.assertions(1);

		const pass = gamePassCurrent();
		const badge = badgeCurrent();
		const snapshot: LiveSnapshot = {
			badge: new Map(),
			developerProduct: new Map([
				[
					asRobloxAssetId("999"),
					{ name: "Untracked", kind: "developerProduct", outputs: {} },
				],
			]),
		};

		expect(compareLiveState([pass, badge], snapshot)).toStrictEqual({
			edits: [],
			missing: [{ key: "first-win", kind: "badge", robloxId: "2468013579" }],
			resources: [pass, badge],
		});
	});

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

	it("should report multiple edits per resource without changing either input", ({ expect }) => {
		expect.assertions(4);

		const pass = Object.freeze(gamePassCurrent());
		const product = Object.freeze(developerProductCurrent({ price: 100 }));
		const livePass = Object.freeze({
			name: "Dashboard pass",
			kind: "gamePass" as const,
			outputs: Object.freeze({}),
			price: 120,
		});
		const snapshot: LiveSnapshot = {
			developerProduct: new Map([
				[
					product.outputs.productId,
					{ kind: "developerProduct", outputs: {}, price: undefined },
				],
			]),
			gamePass: new Map([[pass.outputs.assetId, livePass]]),
		};
		const compared = compareLiveState(Object.freeze([pass, product]), snapshot);

		expect(compared.edits).toStrictEqual([
			{
				key: "vip-pass",
				fields: [
					{ current: "VIP Pass", field: "name", live: "Dashboard pass" },
					{ current: 500, field: "price", live: 120 },
				],
				kind: "gamePass",
			},
			{
				key: "gem-pack",
				fields: [{ current: 100, field: "price", live: undefined }],
				kind: "developerProduct",
			},
		]);
		expect(pass.price).toBe(500);
		expect(livePass).toStrictEqual({
			name: "Dashboard pass",
			kind: "gamePass",
			outputs: {},
			price: 120,
		});
		expect(snapshot.gamePass!.get(pass.outputs.assetId)).toBe(livePass);
	});
});
