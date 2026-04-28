import { assert, describe, expect, it } from "vitest";

import { foldUnsupported } from "./fold-unsupported.ts";
import type { MantleResource } from "./types.ts";

interface DeferredCase {
	readonly humanName: string;
	readonly kind: string;
}

function resource(kind: string, key: string): MantleResource {
	return {
		key,
		dependencies: [],
		inputs: {},
		kind,
		outputs: undefined,
	};
}

const DEFERRED_CASES: ReadonlyArray<DeferredCase> = [
	{ humanName: "asset aliases", kind: "assetAlias" },
	{ humanName: "audio assets", kind: "audioAsset" },
	{ humanName: "badges", kind: "badge" },
	{ humanName: "badge icons", kind: "badgeIcon" },
	{ humanName: "experience icons", kind: "experienceIcon" },
	{ humanName: "experience thumbnails", kind: "experienceThumbnail" },
	{ humanName: "experience thumbnail ordering", kind: "experienceThumbnailOrder" },
	{ humanName: "image assets", kind: "imageAsset" },
	{ humanName: "experience notifications", kind: "notification" },
	{ humanName: "developer products", kind: "product" },
	{ humanName: "developer-product icons", kind: "productIcon" },
];

describe(foldUnsupported, () => {
	it.for(DEFERRED_CASES)(
		"should emit a deferred warning for the $kind Mantle resource kind",
		({ humanName, kind }) => {
			expect.assertions(2);

			const warnings = foldUnsupported([resource(kind, "alpha")]);

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toStrictEqual({
				kind: "deferred",
				mantlePath: `${kind}_alpha`,
				reason: `${humanName}: not yet modeled in bedrock; will surface once the relevant kind ships`,
			});
		},
	);

	it.for(DEFERRED_CASES)(
		"should reuse the same reason text across multiple $kind resources",
		({ kind }) => {
			expect.assertions(3);

			const warnings = foldUnsupported([resource(kind, "alpha"), resource(kind, "beta")]);

			expect(warnings).toHaveLength(2);

			const [first, second] = warnings;
			assert(first?.kind === "deferred" && second?.kind === "deferred");

			expect(first.reason).toBe(second.reason);
			expect(first.reason.length).toBeGreaterThan(0);
		},
	);

	it("should root mantlePath at the resource for the shell to prefix with the environment", () => {
		expect.assertions(1);

		const [warning] = foldUnsupported([resource("badge", "first-win")]);

		expect(warning?.mantlePath).toBe("badge_first-win");
	});

	it("should ignore Mantle kinds that are not in the deferred set", () => {
		expect.assertions(1);

		const warnings = foldUnsupported([
			resource("experience", "singleton"),
			resource("place", "start"),
			resource("gamePass", "vip"),
		]);

		expect(warnings).toStrictEqual([]);
	});

	it("should emit one warning per resource when multiple deferred kinds are present", () => {
		expect.assertions(2);

		const warnings = foldUnsupported([
			resource("badge", "first-win"),
			resource("product", "starter-pack"),
			resource("experienceIcon", "singleton"),
		]);

		expect(warnings).toHaveLength(3);
		expect(warnings.map((warning) => warning.kind)).toStrictEqual([
			"deferred",
			"deferred",
			"deferred",
		]);
	});

	it("should preserve resource ordering in the emitted warning list", () => {
		expect.assertions(1);

		const warnings = foldUnsupported([
			resource("audioAsset", "theme"),
			resource("imageAsset", "logo"),
			resource("badge", "first-win"),
		]);

		expect(warnings.map((warning) => warning.mantlePath)).toStrictEqual([
			"audioAsset_theme",
			"imageAsset_logo",
			"badge_first-win",
		]);
	});

	it("should emit no warnings for an empty resource list", () => {
		expect.assertions(1);

		expect(foldUnsupported([])).toStrictEqual([]);
	});
});
