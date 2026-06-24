import { developerProductCurrent, gamePassCurrent, placeCurrent } from "#tests/helpers/resources";
import { describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { findResource } from "./find-resource.ts";

const vipPass = gamePassCurrent({ key: asResourceKey("vip-pass") });
const goldPass = gamePassCurrent({ key: asResourceKey("gold-pass") });
const startPlace = placeCurrent({ key: asResourceKey("start-place") });

describe(findResource, () => {
	it("should return the first resource of the kind when no key is given", () => {
		expect.assertions(1);

		const found = findResource([startPlace, vipPass, goldPass], { kind: "gamePass" });

		expect(found?.key).toBe("vip-pass");
	});

	it("should return undefined when no resource of the kind is present", () => {
		expect.assertions(1);

		expect(findResource([startPlace], { kind: "gamePass" })).toBeUndefined();
	});

	it("should return the resource matching both kind and key", () => {
		expect.assertions(1);

		const found = findResource([vipPass, goldPass], {
			key: asResourceKey("gold-pass"),
			kind: "gamePass",
		});

		expect(found?.key).toBe("gold-pass");
	});

	it("should return undefined when the kind matches but no resource has the key", () => {
		expect.assertions(1);

		expect(
			findResource([vipPass], { key: asResourceKey("missing"), kind: "gamePass" }),
		).toBeUndefined();
	});

	it("should not match a same-key resource of a different kind", () => {
		expect.assertions(1);

		const sharedKey = asResourceKey("shared");
		const pass = gamePassCurrent({ key: sharedKey });
		const product = developerProductCurrent({ key: sharedKey });

		const found = findResource([pass, product], { key: sharedKey, kind: "developerProduct" });

		expect(found?.kind).toBe("developerProduct");
	});

	it("should return the matched resource's outputs for the selected kind", () => {
		expect.assertions(1);

		const found = findResource([startPlace, vipPass], { kind: "gamePass" });

		expect(found?.outputs.assetId).toBe(asRobloxAssetId("9876543210"));
	});
});
