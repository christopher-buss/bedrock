import { describe, it } from "vitest";

import { gamePassCurrent, gamePassDesired } from "#tests/helpers/resources";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import {
	collectImports,
	type ImportDeclaration,
	importedCurrent,
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

describe(importedCurrent, () => {
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

		expect(importedCurrent(DECLARATION, { desired: gamePassDesired(), live })).toStrictEqual({
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

	it.for([
		["without an icon baseline", { ...DECLARATION, acceptLocalIcon: false }, live],
		[
			"for a pass with no live icon",
			DECLARATION,
			{ ...live, outputs: { iconAssetIds: undefined } },
		],
	] as const)(
		"should refuse an unknown icon hash %s",
		([, declaration, observed], { expect }) => {
			expect.assertions(1);

			expect(
				importedCurrent(declaration, { desired: gamePassDesired(), live: observed }),
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
