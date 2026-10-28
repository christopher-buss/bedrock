import { assert, describe, it } from "vitest";

import { asResourceKey, asSha256Hex } from "../../types/ids.ts";
import { foldBadges } from "./fold-badges.ts";
import type { MantleResource } from "./types.ts";

const SAMPLE_HASH = "86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1";

interface Payload {
	readonly inputs?: unknown;
	readonly outputs?: unknown;
}

function badgeInputs(): Record<string, unknown> {
	return {
		name: "Welcome Example Badge",
		description: "This is an example badge.",
		enabled: true,
		iconFilePath: "assets/badges/example-badge.png",
	};
}

function badgeIconInputs(): Record<string, unknown> {
	return { fileHash: SAMPLE_HASH, filePath: "assets/badges/example-badge.png" };
}

function badge(key: string, payload: Payload = {}): MantleResource {
	return {
		key,
		dependencies: [],
		inputs: "inputs" in payload ? payload.inputs : badgeInputs(),
		kind: "badge",
		outputs:
			"outputs" in payload
				? payload.outputs
				: { assetId: 3630460038655754, initialIconAssetId: 17613681847 },
	};
}

function badgeIcon(key: string, payload: Payload = {}): MantleResource {
	return {
		key,
		dependencies: [],
		inputs: "inputs" in payload ? payload.inputs : badgeIconInputs(),
		kind: "badgeIcon",
		outputs: "outputs" in payload ? payload.outputs : { assetId: 17622418492 },
	};
}

describe(foldBadges, () => {
	it("should fold an enabled badge with its icon partner into one entry", ({ expect }) => {
		expect.assertions(5);

		const result = foldBadges([badge("1-example"), badgeIcon("1-example")]);
		const [entry] = result.badges;
		assert(entry !== undefined);

		expect(entry.key).toBe(asResourceKey("1-example"));
		expect(entry.mantlePath).toBe("badge_1-example");
		expect(entry.entry).toStrictEqual({
			name: "Welcome Example Badge",
			description: "This is an example badge.",
			enabled: true,
			icon: { "en-us": "assets/badges/example-badge.png" },
		});
		expect(entry.outputs).toStrictEqual({
			badgeId: "3630460038655754",
			iconImageId: "17622418492",
		});
		expect(entry.mantleIconFileHashes).toStrictEqual({ "en-us": asSha256Hex(SAMPLE_HASH) });
	});

	it("should keep enabled false explicit on a disabled badge", ({ expect }) => {
		expect.assertions(1);

		const inputs = badgeInputs();
		inputs["enabled"] = false;

		const [entry] = foldBadges([badge("1-example", { inputs })]).badges;
		assert(entry !== undefined);

		expect(entry.entry.enabled).toBe(false);
	});

	it("should preserve non-ASCII characters in name and description", ({ expect }) => {
		expect.assertions(2);

		const inputs = badgeInputs();
		inputs["name"] = "Débutant 初心者 🏅";
		inputs["description"] = "Café — 最初の勝利";

		const [entry] = foldBadges([badge("1-example", { inputs })]).badges;
		assert(entry !== undefined);

		expect(entry.entry.name).toBe("Débutant 初心者 🏅");
		expect(entry.entry.description).toBe("Café — 最初の勝利");
	});

	it("should fold a null or absent description to an empty string", ({ expect }) => {
		expect.assertions(2);

		const nullDescription = badgeInputs();
		// eslint-disable-next-line unicorn/no-null -- Mantle YAML emits `description: ~`
		nullDescription["description"] = null;
		const noDescription = badgeInputs();
		delete noDescription["description"];

		expect(
			foldBadges([badge("a", { inputs: nullDescription })]).badges[0]!.entry.description,
		).toBe("");
		expect(
			foldBadges([badge("a", { inputs: noDescription })]).badges[0]!.entry.description,
		).toBe("");
	});

	it("should fall back to initialIconAssetId without an icon partner", ({ expect }) => {
		expect.assertions(2);

		const [entry] = foldBadges([badge("1-example")]).badges;
		assert(entry !== undefined);

		expect(entry.outputs.iconImageId).toBe("17613681847");
		expect(entry.mantleIconFileHashes).toBeNil();
	});

	it("should fall back to initialIconAssetId when the icon partner is malformed", ({
		expect,
	}) => {
		expect.assertions(5);

		const badHash = badgeIconInputs();
		badHash["fileHash"] = "not-a-real-hash";

		const malformedInputs = foldBadges([badge("a"), badgeIcon("a", { inputs: badHash })])
			.badges[0];
		const malformedOutputs = foldBadges([badge("a"), badgeIcon("a", { outputs: {} })])
			.badges[0];
		assert(malformedInputs !== undefined && malformedOutputs !== undefined);

		expect(malformedInputs.outputs.iconImageId).toBe("17613681847");
		expect(malformedInputs.mantleIconFileHashes).toBeNil();
		expect(malformedOutputs.outputs.iconImageId).toBe("17613681847");
		expect(malformedOutputs.mantleIconFileHashes).toBeNil();
		expect(
			foldBadges([badge("a"), badgeIcon("a", { inputs: "not-an-object" })]).badges[0]!.outputs
				.iconImageId,
		).toBe("17613681847");
	});

	it("should emit no warning for a badgeIcon paired with its badge", ({ expect }) => {
		expect.assertions(1);

		const result = foldBadges([badge("1-example"), badgeIcon("1-example")]);

		expect(result.warnings).toStrictEqual([]);
	});

	it("should emit an ambiguous warning for an orphan badgeIcon resource", ({ expect }) => {
		expect.assertions(2);

		const result = foldBadges([badgeIcon("1-example")]);

		expect(result.badges).toStrictEqual([]);
		expect(result.warnings).toStrictEqual([
			{
				hint: "Verify your Mantle state file: each badgeIcon_<k> resource must be paired with a matching badge_<k>.",
				kind: "ambiguous",
				mantlePath: "badgeIcon_1-example",
			},
		]);
	});

	it("should ignore resources of other kinds", ({ expect }) => {
		expect.assertions(1);

		const result = foldBadges([{ ...badge("a"), kind: "pass" }]);

		expect(result).toStrictEqual({ badges: [], warnings: [] });
	});

	it("should drop a badge whose inputs are malformed", ({ expect }) => {
		expect.assertions(5);

		const noName = badgeInputs();
		delete noName["name"];
		const noEnabled = badgeInputs();
		delete noEnabled["enabled"];
		const noIcon = badgeInputs();
		delete noIcon["iconFilePath"];
		const numericDescription = badgeInputs();
		numericDescription["description"] = 5;

		expect(foldBadges([badge("a", { inputs: "not-an-object" })]).badges).toStrictEqual([]);
		expect(foldBadges([badge("a", { inputs: noName })]).badges).toStrictEqual([]);
		expect(foldBadges([badge("a", { inputs: noEnabled })]).badges).toStrictEqual([]);
		expect(foldBadges([badge("a", { inputs: noIcon })]).badges).toStrictEqual([]);
		expect(foldBadges([badge("a", { inputs: numericDescription })]).badges).toStrictEqual([]);
	});

	it("should drop a badge whose outputs are malformed", ({ expect }) => {
		expect.assertions(3);

		// eslint-disable-next-line unicorn/no-null -- exercising the null branch of the defensive guard
		expect(foldBadges([badge("a", { outputs: null })]).badges).toStrictEqual([]);
		expect(
			foldBadges([badge("a", { outputs: { initialIconAssetId: 1 } })]).badges,
		).toStrictEqual([]);
		expect(foldBadges([badge("a", { outputs: { assetId: 1 } })]).badges).toStrictEqual([]);
	});
});
