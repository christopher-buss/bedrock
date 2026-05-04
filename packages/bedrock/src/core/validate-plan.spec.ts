import {
	developerProductCurrent,
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
} from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { asSha256Hex } from "../types/ids.ts";
import { validatePlan } from "./validate-plan.ts";

const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

describe(validatePlan, () => {
	it("should return ok when there is no current state to compare against", () => {
		expect.assertions(1);

		expect(validatePlan([developerProductDesired()], [])).toStrictEqual({
			data: undefined,
			success: true,
		});
	});

	it("should return ok when no developer-product entry transitions from icon-set to icon-absent", () => {
		expect.assertions(1);

		expect(
			validatePlan([developerProductDesired()], [developerProductCurrent()]),
		).toStrictEqual({ data: undefined, success: true });
	});

	it("should return ok when a developer-product gains an icon (current absent, desired present)", () => {
		expect.assertions(1);

		const desired = developerProductDesired({
			icon: { "en-us": "assets/gem-pack.png" },
			iconFileHashes: { "en-us": ICON_HASH },
		});

		expect(validatePlan([desired], [developerProductCurrent()])).toStrictEqual({
			data: undefined,
			success: true,
		});
	});

	it("should return ok when both current and desired declare an icon", () => {
		expect.assertions(1);

		const icon = { "en-us": "assets/gem-pack.png" };
		const iconFileHashes = { "en-us": ICON_HASH };

		expect(
			validatePlan(
				[developerProductDesired({ icon, iconFileHashes })],
				[developerProductCurrent({ icon, iconFileHashes })],
			),
		).toStrictEqual({ data: undefined, success: true });
	});

	it("should reject when a developer-product had an icon recorded but desired drops it", () => {
		expect.assertions(3);

		const current = developerProductCurrent({
			icon: { "en-us": "assets/gem-pack.png" },
			iconFileHashes: { "en-us": ICON_HASH },
		});

		const result = validatePlan([developerProductDesired()], [current]);
		assert(!result.success);
		assert(result.err.kind === "iconRemovalRejected");

		expect(result.err.key).toBe(developerProductDesired().key);
		expect(result.err.message).toContain(developerProductDesired().key);
		expect(result.err.message).toContain("icon");
	});

	it("should ignore current entries that have no matching desired entry", () => {
		expect.assertions(1);

		const orphanCurrent = developerProductCurrent({
			icon: { "en-us": "assets/gem-pack.png" },
			iconFileHashes: { "en-us": ICON_HASH },
		});

		expect(validatePlan([], [orphanCurrent])).toStrictEqual({
			data: undefined,
			success: true,
		});
	});

	it("should pair entries by composite kind+key, not by key alone", () => {
		expect.assertions(1);

		expect(
			validatePlan(
				[developerProductDesired(), gamePassDesired()],
				[
					developerProductCurrent({
						icon: { "en-us": "assets/gem-pack.png" },
						iconFileHashes: { "en-us": ICON_HASH },
					}),
					gamePassCurrent(),
				],
			).success,
		).toBeFalse();
	});

	it("should not cross-match a developer-product desired against a same-keyed game-pass current", () => {
		expect.assertions(1);

		const sharedKey = developerProductDesired().key;

		expect(
			validatePlan(
				[developerProductDesired({ key: sharedKey })],
				[
					gamePassCurrent({
						key: sharedKey,
						icon: { "en-us": "assets/sticker.png" },
						iconFileHashes: { "en-us": ICON_HASH },
					}),
				],
			),
		).toStrictEqual({ data: undefined, success: true });
	});
});
