import { describe, it } from "vitest";

import {
	badgeDesired,
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
} from "#tests/helpers/resources";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import {
	collectImports,
	type ImportDeclaration,
	importedBadge,
	importedDeveloperProduct,
	importedGamePass,
	importNotLive,
	importUnreadable,
	pendingImports,
} from "./import-current.ts";

const DECLARATION: ImportDeclaration = {
	key: asResourceKey("vip-pass"),
	acceptLocalIcon: true,
	environment: "production",
	kind: "gamePass",
	robloxId: asRobloxAssetId("9876543210"),
};
const LINE = 'environments.production.passes.vip-pass.importId "9876543210"';
const PRODUCT: ImportDeclaration = {
	key: asResourceKey("gem-pack"),
	acceptLocalIcon: false,
	environment: "production",
	kind: "developerProduct",
	robloxId: asRobloxAssetId("8172635495"),
};
const PRODUCT_LINE = 'environments.production.products.gem-pack.importId "8172635495"';
const BADGE: ImportDeclaration = {
	key: asResourceKey("first-win"),
	acceptLocalIcon: true,
	environment: "production",
	kind: "badge",
	robloxId: asRobloxAssetId("2468013579"),
};
const BADGE_LINE = 'environments.production.badges.first-win.importId "2468013579"';
const NO_ICON_HASH =
	'has no known icon hash: supply the icon file and add iconBaseline: "accept-local-file" beside importId.';

describe(collectImports, () => {
	it("should collect the importId lines of the selected Environment only", ({ expect }) => {
		expect.assertions(1);

		const imports = collectImports(
			{
				environments: {
					production: {
						passes: {
							"old": { retired: true },
							"plain": { price: 5 },
							"trusted": { importId: "11" },
							"vip-pass": {
								iconBaseline: "accept-local-file",
								importId: "9876543210",
							},
						},
					},
					staging: { passes: { "vip-pass": { importId: "22" } } },
				},
			},
			"production",
		);

		expect(imports).toStrictEqual([
			{ ...DECLARATION, key: "trusted", acceptLocalIcon: false, robloxId: "11" },
			DECLARATION,
		]);
	});

	it("should collect the importId lines of badges after products", ({ expect }) => {
		expect.assertions(1);

		const imports = collectImports(
			{
				environments: {
					production: {
						badges: {
							"first-win": {
								iconBaseline: "accept-local-file",
								importId: "2468013579",
							},
						},
						products: { "gem-pack": { importId: "8172635495" } },
					},
				},
			},
			"production",
		);

		expect(imports).toStrictEqual([PRODUCT, BADGE]);
	});

	it("should collect the importId lines of products after passes", ({ expect }) => {
		expect.assertions(1);

		const imports = collectImports(
			{
				environments: {
					production: {
						passes: {
							"vip-pass": {
								iconBaseline: "accept-local-file",
								importId: "9876543210",
							},
						},
						products: { "gem-pack": { importId: "8172635495" } },
					},
				},
			},
			"production",
		);

		expect(imports).toStrictEqual([DECLARATION, PRODUCT]);
	});

	it("should collect nothing for an Environment without passes", ({ expect }) => {
		expect.assertions(1);

		expect(collectImports({ environments: { production: {} } }, "production")).toStrictEqual(
			[],
		);
	});
});

describe(pendingImports, () => {
	it("should skip a Key whose State already tracks its declared id", ({ expect }) => {
		expect.assertions(1);

		expect(pendingImports([DECLARATION], [gamePassCurrent()])).toStrictEqual({
			data: [],
			success: true,
		});
	});

	it("should keep a Key no State holds, ignoring other Kinds with the same Key or id", ({
		expect,
	}) => {
		expect.assertions(1);

		const product = {
			key: DECLARATION.key,
			name: "Gems",
			description: "Gems",
			kind: "developerProduct" as const,
			outputs: { productId: DECLARATION.robloxId },
			price: 5,
		};

		expect(pendingImports([DECLARATION], [product])).toStrictEqual({
			data: [DECLARATION],
			success: true,
		});
	});

	it("should keep an id no other pass in State holds", ({ expect }) => {
		expect.assertions(1);

		const saved = gamePassCurrent({
			key: asResourceKey("gold-pass"),
			outputs: { ...gamePassCurrent().outputs, assetId: asRobloxAssetId("1") },
		});

		expect(pendingImports([DECLARATION], [saved])).toStrictEqual({
			data: [DECLARATION],
			success: true,
		});
	});

	it("should keep imports of different Kinds that share a Key or an id", ({ expect }) => {
		expect.assertions(1);

		const product = { ...PRODUCT, key: DECLARATION.key, robloxId: DECLARATION.robloxId };

		expect(pendingImports([DECLARATION, product], [])).toStrictEqual({
			data: [DECLARATION, product],
			success: true,
		});
	});

	it("should refuse a Key whose State holds another id", ({ expect }) => {
		expect.assertions(1);

		const saved = gamePassCurrent({
			outputs: { ...gamePassCurrent().outputs, assetId: asRobloxAssetId("1") },
		});

		expect(pendingImports([DECLARATION], [saved])).toStrictEqual({
			err: {
				key: "vip-pass",
				kind: "importRejected",
				message: `${LINE} cannot be imported: 'vip-pass' already has State.`,
			},
			success: false,
		});
	});

	it("should refuse an id another Key tracks", ({ expect }) => {
		expect.assertions(1);

		const saved = gamePassCurrent({ key: asResourceKey("gold-pass") });

		expect(pendingImports([DECLARATION], [saved])).toStrictEqual({
			err: {
				key: "vip-pass",
				kind: "importRejected",
				message: `${LINE} cannot be imported: 'gold-pass' already tracks it.`,
			},
			success: false,
		});
	});

	it("should refuse an id another Key imports in the same run", ({ expect }) => {
		expect.assertions(1);

		const gold = { ...DECLARATION, key: asResourceKey("gold-pass") };

		expect(pendingImports([gold, DECLARATION], [])).toStrictEqual({
			err: {
				key: "vip-pass",
				kind: "importRejected",
				message: `${LINE} cannot be imported: 'gold-pass' already tracks it.`,
			},
			success: false,
		});
	});
});

describe(importNotLive, () => {
	it.for([
		[undefined, "is not a live game pass in this Environment's universe."],
		["developerProduct", "is a developer product, not a game pass."],
		["badge", "is a badge, not a game pass."],
	] as const)("should name the line for other Kind %s", ([otherKind, reason], { expect }) => {
		expect.assertions(1);

		expect(importNotLive(DECLARATION, otherKind)).toStrictEqual({
			err: { key: "vip-pass", kind: "importRejected", message: `${LINE} ${reason}` },
			success: false,
		});
	});
});

describe("importNotLive for a developer product", () => {
	it.for([
		[undefined, "is not a live developer product in this Environment's universe."],
		["gamePass", "is a game pass, not a developer product."],
	] as const)(
		"should name the products line for other Kind %s",
		([otherKind, reason], { expect }) => {
			expect.assertions(1);

			expect(importNotLive(PRODUCT, otherKind)).toStrictEqual({
				err: {
					key: "gem-pack",
					kind: "importRejected",
					message: `${PRODUCT_LINE} ${reason}`,
				},
				success: false,
			});
		},
	);
});

describe("importNotLive for a badge", () => {
	it.for([
		[undefined, "is not a live badge in this Environment's universe."],
		["developerProduct", "is a developer product, not a badge."],
	] as const)(
		"should name the badges line for other Kind %s",
		([otherKind, reason], { expect }) => {
			expect.assertions(1);

			expect(importNotLive(BADGE, otherKind)).toStrictEqual({
				err: {
					key: "first-win",
					kind: "importRejected",
					message: `${BADGE_LINE} ${reason}`,
				},
				success: false,
			});
		},
	);
});

describe(importUnreadable, () => {
	it("should name the line and the missing credential", ({ expect }) => {
		expect.assertions(1);

		expect(importUnreadable(DECLARATION)).toStrictEqual({
			err: {
				key: "vip-pass",
				kind: "importRejected",
				message: `${LINE} cannot be read: importing needs an Open Cloud credential.`,
			},
			success: false,
		});
	});
});

describe(importedGamePass, () => {
	const live = {
		name: "Live VIP",
		description: "Live perks",
		isManagedPricingEnabled: false,
		kind: "gamePass" as const,
		outputs: {
			assetId: DECLARATION.robloxId,
			iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
		},
		price: undefined,
	};

	it("should record live values with the local icon path and hash", ({ expect }) => {
		expect.assertions(1);

		expect(importedGamePass(DECLARATION, { desired: gamePassDesired(), live })).toStrictEqual({
			data: {
				...gamePassDesired(),
				name: "Live VIP",
				description: "Live perks",
				isManagedPricingEnabled: false,
				outputs: live.outputs,
				price: undefined,
			},
			success: true,
		});
	});

	it("should record the local icon without a baseline when it matches the stored icon", ({
		expect,
	}) => {
		expect.assertions(1);

		const desired = gamePassDesired();

		expect(
			importedGamePass(
				{ ...DECLARATION, acceptLocalIcon: false },
				{ desired, live, storedIconHash: desired.iconFileHashes["en-us"] },
			),
		).toMatchObject({ data: { iconFileHashes: desired.iconFileHashes }, success: true });
	});

	it.for([
		["without an icon baseline", { ...DECLARATION, acceptLocalIcon: false }, live, undefined],
		[
			"for a local icon that differs from the stored icon",
			{ ...DECLARATION, acceptLocalIcon: false },
			live,
			asSha256Hex("0".repeat(64)),
		],
		[
			"for a pass with no live icon",
			DECLARATION,
			{ ...live, outputs: { iconAssetIds: undefined } },
			undefined,
		],
	] as const)(
		"should refuse an unknown icon hash %s",
		([, declaration, observed, storedIconHash], { expect }) => {
			expect.assertions(1);

			expect(
				importedGamePass(declaration, {
					desired: gamePassDesired(),
					live: observed,
					storedIconHash,
				}),
			).toStrictEqual({
				err: {
					key: "vip-pass",
					kind: "importRejected",
					message: `${LINE} has no known icon hash: supply the icon file and add iconBaseline: "accept-local-file" beside importId.`,
				},
				success: false,
			});
		},
	);
});

describe(importedDeveloperProduct, () => {
	const live = {
		name: "Live Gems",
		description: "Live gems",
		isManagedPricingEnabled: false,
		kind: "developerProduct" as const,
		outputs: {
			iconImageAssetId: asRobloxAssetId("5544332211"),
			productId: PRODUCT.robloxId,
		},
		price: 75,
	};
	const withIcon = developerProductDesired({
		icon: { "en-us": "assets/gems.png" },
		iconFileHashes: gamePassDesired().iconFileHashes,
	});

	it("should record a product without a config icon and keep its live icon id", ({ expect }) => {
		expect.assertions(1);

		expect(
			importedDeveloperProduct(PRODUCT, { desired: developerProductDesired(), live }),
		).toStrictEqual({
			data: {
				...developerProductDesired(),
				name: "Live Gems",
				description: "Live gems",
				isManagedPricingEnabled: false,
				outputs: live.outputs,
				price: 75,
			},
			success: true,
		});
	});

	it("should record a product without any icon", ({ expect }) => {
		expect.assertions(1);

		const result = importedDeveloperProduct(PRODUCT, {
			desired: developerProductDesired(),
			live: { ...live, outputs: { iconImageAssetId: undefined } },
		});

		expect(result.success && result.data.outputs).toStrictEqual({
			productId: PRODUCT.robloxId,
		});
	});

	it("should record the local icon path and hash with an icon baseline", ({ expect }) => {
		expect.assertions(1);

		expect(
			importedDeveloperProduct(
				{ ...PRODUCT, acceptLocalIcon: true },
				{ desired: withIcon, live },
			),
		).toMatchObject({
			data: {
				icon: withIcon.icon,
				iconFileHashes: withIcon.iconFileHashes,
				outputs: live.outputs,
			},
			success: true,
		});
	});

	it("should record the local icon without a baseline when it matches the stored icon", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(
			importedDeveloperProduct(PRODUCT, {
				desired: withIcon,
				live,
				storedIconHash: withIcon.iconFileHashes!["en-us"],
			}),
		).toMatchObject({ data: { iconFileHashes: withIcon.iconFileHashes }, success: true });
	});

	it("should refuse a config icon with neither a local hash nor a stored icon", ({ expect }) => {
		expect.assertions(1);

		expect(
			importedDeveloperProduct(PRODUCT, {
				desired: developerProductDesired({ icon: { "en-us": "assets/gems.png" } }),
				live,
			}).success,
		).toBe(false);
	});

	it.for([
		["without an icon baseline", PRODUCT, live, undefined],
		[
			"for a local icon that differs from the stored icon",
			PRODUCT,
			live,
			asSha256Hex("0".repeat(64)),
		],
		[
			"for a product with no live icon",
			{ ...PRODUCT, acceptLocalIcon: true },
			{ ...live, outputs: { iconImageAssetId: undefined } },
			undefined,
		],
	] as const)(
		"should refuse a config icon with an unknown hash %s",
		([, declaration, observed, storedIconHash], { expect }) => {
			expect.assertions(1);

			expect(
				importedDeveloperProduct(declaration, {
					desired: withIcon,
					live: observed,
					storedIconHash,
				}),
			).toStrictEqual({
				err: {
					key: "gem-pack",
					kind: "importRejected",
					message: `${PRODUCT_LINE} ${NO_ICON_HASH}`,
				},
				success: false,
			});
		},
	);
});

describe(importedBadge, () => {
	const live = {
		name: "Live Win",
		description: "Live description",
		enabled: false,
		kind: "badge" as const,
		outputs: { badgeId: BADGE.robloxId, iconImageId: asRobloxAssetId("1357924680") },
	};

	it("should record live values, including a disabled state, with the local icon path and hash", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(importedBadge(BADGE, { desired: badgeDesired(), live })).toStrictEqual({
			data: {
				...badgeDesired(),
				name: "Live Win",
				description: "Live description",
				enabled: false,
				outputs: { badgeId: BADGE.robloxId, iconImageId: asRobloxAssetId("1357924680") },
			},
			success: true,
		});
	});

	it("should record the local icon without a baseline when it matches the stored icon", ({
		expect,
	}) => {
		expect.assertions(1);

		const desired = badgeDesired();

		expect(
			importedBadge(
				{ ...BADGE, acceptLocalIcon: false },
				{ desired, live, storedIconHash: desired.iconFileHashes["en-us"] },
			),
		).toMatchObject({ data: { iconFileHashes: desired.iconFileHashes }, success: true });
	});

	it.for([
		["without an icon baseline", { ...BADGE, acceptLocalIcon: false }, live, undefined],
		[
			"for a local icon that differs from the stored icon",
			{ ...BADGE, acceptLocalIcon: false },
			live,
			asSha256Hex("0".repeat(64)),
		],
		[
			"for a badge with no live icon",
			BADGE,
			{ ...live, outputs: { iconImageId: undefined } },
			undefined,
		],
	] as const)(
		"should refuse an unknown icon hash %s",
		([, declaration, observed, storedIconHash], { expect }) => {
			expect.assertions(1);

			expect(
				importedBadge(declaration, {
					desired: badgeDesired(),
					live: observed,
					storedIconHash,
				}),
			).toStrictEqual({
				err: {
					key: "first-win",
					kind: "importRejected",
					message: `${BADGE_LINE} ${NO_ICON_HASH}`,
				},
				success: false,
			});
		},
	);
});
