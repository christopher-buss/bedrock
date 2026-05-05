import { developerProductDesired } from "#tests/helpers/resources";
import { describe, expect, it } from "vitest";

import { planFollowUpPatch } from "./plan-follow-up-patch.ts";

describe(planFollowUpPatch, () => {
	it("should return undefined when desired.storePageEnabled is undefined", () => {
		expect.assertions(1);

		expect(
			planFollowUpPatch(developerProductDesired({ storePageEnabled: undefined }), {
				storePageEnabled: false,
			}),
		).toBeUndefined();
	});

	it("should return undefined when desired.storePageEnabled equals the create response value", () => {
		expect.assertions(2);

		expect(
			planFollowUpPatch(developerProductDesired({ storePageEnabled: true }), {
				storePageEnabled: true,
			}),
		).toBeUndefined();
		expect(
			planFollowUpPatch(developerProductDesired({ storePageEnabled: false }), {
				storePageEnabled: false,
			}),
		).toBeUndefined();
	});

	it("should return a PATCH body carrying the desired value when desired differs from the create response", () => {
		expect.assertions(2);

		expect(
			planFollowUpPatch(developerProductDesired({ storePageEnabled: true }), {
				storePageEnabled: false,
			}),
		).toStrictEqual({ storePageEnabled: true });
		expect(
			planFollowUpPatch(developerProductDesired({ storePageEnabled: false }), {
				storePageEnabled: true,
			}),
		).toStrictEqual({ storePageEnabled: false });
	});
});
