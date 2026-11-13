import { describe, it } from "vitest";

import { badgeDesired, developerProductDesired, gamePassDesired } from "#tests/helpers/resources";
import { asRobloxAssetId } from "../types/ids.ts";
import type { ResourceLiveState } from "./live-state.ts";
import { recoverBadge, recoverDeveloperProduct, recoverGamePass } from "./recover-create.ts";

const OLD = asRobloxAssetId("1");
const NEW = asRobloxAssetId("2");
const OTHER = asRobloxAssetId("3");
const ICON = asRobloxAssetId("77");

function pass(name = "VIP Pass"): ResourceLiveState<"gamePass"> {
	return {
		name,
		kind: "gamePass",
		outputs: { iconAssetIds: { "en-us": ICON } },
		price: 120,
	};
}

describe(recoverGamePass, () => {
	it("should record the one new pass with the desired name, keeping its live fields", ({
		expect,
	}) => {
		expect.assertions(1);

		const desired = gamePassDesired({ name: "VIP Pass" });

		expect(
			recoverGamePass(desired, {
				after: new Map([
					[NEW, pass()],
					[OLD, pass()],
					[OTHER, pass("VIP Pass ")],
				]),
				before: new Map([[OLD, pass()]]),
				claimed: new Set(),
			}),
		).toStrictEqual({
			...desired,
			outputs: { assetId: NEW, iconAssetIds: { "en-us": ICON } },
			price: 120,
		});
	});

	it("should refuse when no new pass carries the name", ({ expect }) => {
		expect.assertions(1);

		expect(
			recoverGamePass(gamePassDesired({ name: "VIP Pass" }), {
				after: new Map([[OLD, pass()]]),
				before: new Map([[OLD, pass()]]),
				claimed: new Set(),
			}),
		).toBeUndefined();
	});

	it("should refuse when more than one new pass carries the name", ({ expect }) => {
		expect.assertions(1);

		expect(
			recoverGamePass(gamePassDesired({ name: "VIP Pass" }), {
				after: new Map([
					[NEW, pass()],
					[OTHER, pass()],
				]),
				before: new Map(),
				claimed: new Set(),
			}),
		).toBeUndefined();
	});

	it("should skip a new pass this run already recorded for another create", ({ expect }) => {
		expect.assertions(1);

		expect(
			recoverGamePass(gamePassDesired({ name: "VIP Pass" }), {
				after: new Map([
					[NEW, pass()],
					[OTHER, pass()],
				]),
				before: new Map(),
				claimed: new Set([OTHER]),
			}),
		).toMatchObject({ outputs: { assetId: NEW } });
	});

	it("should refuse a new pass whose icon Roblox does not report", ({ expect }) => {
		expect.assertions(1);

		expect(
			recoverGamePass(gamePassDesired({ name: "VIP Pass" }), {
				after: new Map([[NEW, { ...pass(), outputs: { iconAssetIds: undefined } }]]),
				before: new Map(),
				claimed: new Set(),
			}),
		).toBeUndefined();
	});
});

describe(recoverDeveloperProduct, () => {
	const product: ResourceLiveState<"developerProduct"> = {
		name: "Gem Pack",
		kind: "developerProduct",
		outputs: { iconImageAssetId: ICON, productId: NEW },
		price: 50,
	};

	it("should record the new product with the icon the config declares", ({ expect }) => {
		expect.assertions(1);

		const desired = developerProductDesired({ name: "Gem Pack", icon: { "en-us": "gem.png" } });

		expect(
			recoverDeveloperProduct(desired, {
				after: new Map([[NEW, product]]),
				before: new Map(),
				claimed: new Set(),
			}),
		).toStrictEqual({
			...desired,
			outputs: { iconImageAssetId: ICON, productId: NEW },
			price: 50,
		});
	});

	it("should record a product without an icon when the config declares none", ({ expect }) => {
		expect.assertions(1);

		expect(
			recoverDeveloperProduct(developerProductDesired({ name: "Gem Pack" }), {
				after: new Map([[NEW, { ...product, outputs: { iconImageAssetId: undefined } }]]),
				before: new Map(),
				claimed: new Set(),
			})!.outputs,
		).toStrictEqual({ productId: NEW });
	});

	it("should refuse a product missing the icon the config declares", ({ expect }) => {
		expect.assertions(1);

		expect(
			recoverDeveloperProduct(
				developerProductDesired({ name: "Gem Pack", icon: { "en-us": "gem.png" } }),
				{
					after: new Map([
						[NEW, { ...product, outputs: { iconImageAssetId: undefined } }],
					]),
					before: new Map(),
					claimed: new Set(),
				},
			),
		).toBeUndefined();
	});

	it("should refuse when no new product carries the name", ({ expect }) => {
		expect.assertions(1);

		expect(
			recoverDeveloperProduct(developerProductDesired({ name: "Gem Pack" }), {
				after: new Map(),
				before: new Map(),
				claimed: new Set(),
			}),
		).toBeUndefined();
	});
});

describe(recoverBadge, () => {
	const badge: ResourceLiveState<"badge"> = {
		name: "Winner",
		enabled: true,
		kind: "badge",
		outputs: { badgeId: NEW, iconImageId: ICON },
	};

	it("should record the new badge with its icon", ({ expect }) => {
		expect.assertions(1);

		const desired = badgeDesired({ name: "Winner" });

		expect(
			recoverBadge(desired, {
				after: new Map([[NEW, badge]]),
				before: new Map(),
				claimed: new Set(),
			}),
		).toStrictEqual({ ...desired, outputs: { badgeId: NEW, iconImageId: ICON } });
	});

	it("should refuse a new badge whose icon Roblox does not report", ({ expect }) => {
		expect.assertions(1);

		expect(
			recoverBadge(badgeDesired({ name: "Winner" }), {
				after: new Map([[NEW, { ...badge, outputs: { iconImageId: undefined } }]]),
				before: new Map(),
				claimed: new Set(),
			}),
		).toBeUndefined();
	});

	it("should refuse when no new badge carries the name", ({ expect }) => {
		expect.assertions(1);

		expect(
			recoverBadge(badgeDesired({ name: "Winner" }), {
				after: new Map(),
				before: new Map(),
				claimed: new Set(),
			}),
		).toBeUndefined();
	});
});
