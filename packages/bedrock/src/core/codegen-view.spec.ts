import { describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { codegenView, isRedacted, pushedValue, realValue } from "./codegen-view.ts";
import type { ResourceCurrentState } from "./resources.ts";

const redactedPass: ResourceCurrentState<"gamePass"> = {
	key: asResourceKey("vip-pass"),
	name: "Redacted Pass",
	description: "",
	icon: { "en-us": "assets/vip-icon.png" },
	iconFileHashes: {
		"en-us": asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
	},
	kind: "gamePass",
	outputs: {
		assetId: asRobloxAssetId("9876543210"),
		iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
	},
	price: 99_999,
};

const redactedPlace: ResourceCurrentState<"place"> = {
	key: asResourceKey("start"),
	description: "",
	displayName: "[DEV] Hidden Lobby",
	fileHash: asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
	filePath: "places/start.rbxl",
	kind: "place",
	outputs: { versionNumber: 7 },
	placeId: asRobloxAssetId("4711"),
	serverSize: 50,
};

describe(realValue, () => {
	it("should return the scalar itself for a non-redacted field", () => {
		expect.assertions(1);

		expect(realValue("VIP Pass")).toBe("VIP Pass");
	});

	it("should return the real value for a redacted field", () => {
		expect.assertions(1);

		expect(realValue({ redacted: "Redacted Pass", value: "VIP Pass" })).toBe("VIP Pass");
	});
});

describe(pushedValue, () => {
	it("should return the scalar itself for a non-redacted field", () => {
		expect.assertions(1);

		expect(pushedValue(500)).toBe(500);
	});

	it("should return the pushed placeholder for a redacted field", () => {
		expect.assertions(1);

		expect(pushedValue({ redacted: 99_999, value: 500 })).toBe(99_999);
	});
});

describe(isRedacted, () => {
	it("should report false for a non-redacted string field", () => {
		expect.assertions(1);

		expect(isRedacted("VIP Pass")).toBeFalse();
	});

	it("should report false for a non-redacted number field", () => {
		expect.assertions(1);

		expect(isRedacted(500)).toBeFalse();
	});

	it("should report true for a redacted field", () => {
		expect.assertions(1);

		expect(isRedacted({ redacted: "Redacted Pass", value: "VIP Pass" })).toBeTrue();
	});
});

describe(codegenView, () => {
	it("should present a hidden field as the object form carrying real and pushed values", () => {
		expect.assertions(1);

		const view = codegenView(redactedPass, {
			name: "VIP Pass",
			description: "Grants VIP perks.",
			price: 500,
		});

		expect(view.name).toStrictEqual({ redacted: "Redacted Pass", value: "VIP Pass" });
	});

	it("should let helpers recover the real value from the projected field", () => {
		expect.assertions(2);

		const view = codegenView(redactedPass, { name: "VIP Pass" });

		expect(realValue(view.name)).toBe("VIP Pass");
		expect(pushedValue(view.name)).toBe("Redacted Pass");
	});

	it("should keep a redactable field scalar when there is no real-display entry", () => {
		expect.assertions(2);

		const view = codegenView(redactedPass);

		expect(view.name).toBe("Redacted Pass");
		expect(isRedacted(view.name)).toBeFalse();
	});

	it("should keep a redactable field scalar when its real value equals the pushed value", () => {
		expect.assertions(2);

		const view = codegenView(redactedPass, { name: "Redacted Pass" });

		expect(view.name).toBe("Redacted Pass");
		expect(isRedacted(view.name)).toBeFalse();
	});

	it("should keep a redactable field scalar when only other fields are hidden", () => {
		expect.assertions(1);

		const view = codegenView(redactedPass, { name: "VIP Pass" });

		expect(view.price).toBe(99_999);
	});

	it("should project a redacted place display name as the object form", () => {
		expect.assertions(1);

		const view = codegenView(redactedPlace, { displayName: "Start Place" });

		expect(view.displayName).toStrictEqual({
			redacted: "[DEV] Hidden Lobby",
			value: "Start Place",
		});
	});
});
