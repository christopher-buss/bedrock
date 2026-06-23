import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { coLocateRealDisplay, parseStateFile, serializeStateFile } from "./state-file.ts";
import type { BedrockState } from "./state.ts";

const redactedPass: BedrockState["resources"][number] = {
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

const stateWithRealDisplay: BedrockState = {
	environment: "dev",
	realDisplay: {
		"gamePass:vip-pass": { name: "VIP Pass", description: "Grants VIP perks.", price: 500 },
	},
	resources: [redactedPass],
	version: 1,
};

describe(coLocateRealDisplay, () => {
	it("should return an uncovered resource by reference without an undefined sibling", () => {
		expect.assertions(1);

		const result = coLocateRealDisplay([redactedPass], {
			"gamePass:other-pass": { name: "Other" },
		});

		expect(result[0]).toBe(redactedPass);
	});

	it("should attach the sibling as a new object for a covered resource", () => {
		expect.assertions(1);

		const result = coLocateRealDisplay([redactedPass], {
			"gamePass:vip-pass": { name: "VIP Pass" },
		});

		expect(result[0]).toStrictEqual({ ...redactedPass, $realDisplay: { name: "VIP Pass" } });
	});
});

describe(serializeStateFile, () => {
	it("should co-locate a $realDisplay sibling on the resource it describes", () => {
		expect.assertions(1);

		const wire = JSON.parse(serializeStateFile(stateWithRealDisplay)) as unknown as {
			resources: ReadonlyArray<Record<string, unknown>>;
		};

		expect(wire.resources[0]!["$realDisplay"]).toStrictEqual({
			name: "VIP Pass",
			description: "Grants VIP perks.",
			price: 500,
		});
	});

	it("should omit $realDisplay from a resource with no real-display entry", () => {
		expect.assertions(1);

		const wire = JSON.parse(
			serializeStateFile({
				environment: "production",
				resources: [redactedPass],
				version: 1,
			}),
		) as unknown as { resources: ReadonlyArray<Record<string, unknown>> };

		expect(wire.resources[0]).not.toContainKey("$realDisplay");
	});

	it("should attach $realDisplay to a resource the map covers", () => {
		expect.assertions(1);

		const otherPass: BedrockState["resources"][number] = {
			...redactedPass,
			key: asResourceKey("plain-pass"),
		};
		const wire = JSON.parse(
			serializeStateFile({ ...stateWithRealDisplay, resources: [redactedPass, otherPass] }),
		) as unknown as { resources: ReadonlyArray<Record<string, unknown>> };

		expect(wire.resources[0]).toContainKey("$realDisplay");
	});

	it("should leave a resource bare when the map does not cover it", () => {
		expect.assertions(1);

		const otherPass: BedrockState["resources"][number] = {
			...redactedPass,
			key: asResourceKey("plain-pass"),
		};
		const wire = JSON.parse(
			serializeStateFile({ ...stateWithRealDisplay, resources: [redactedPass, otherPass] }),
		) as unknown as { resources: ReadonlyArray<Record<string, unknown>> };

		expect(wire.resources[1]).not.toContainKey("$realDisplay");
	});
});

describe(parseStateFile, () => {
	it("should lift each $realDisplay sibling into the realDisplay map", () => {
		expect.assertions(1);

		const parsed = parseStateFile(serializeStateFile(stateWithRealDisplay), "state.dev.json");
		assert(parsed.success);

		expect(parsed.data?.realDisplay).toStrictEqual({
			"gamePass:vip-pass": { name: "VIP Pass", description: "Grants VIP perks.", price: 500 },
		});
	});

	it("should strip $realDisplay from the parsed resource so the diff path never sees it", () => {
		expect.assertions(1);

		const parsed = parseStateFile(serializeStateFile(stateWithRealDisplay), "state.dev.json");
		assert(parsed.success);

		expect(parsed.data?.resources[0]).not.toContainKey("$realDisplay");
	});

	it("should leave realDisplay absent when no resource carries a sibling", () => {
		expect.assertions(1);

		const wire = serializeStateFile({
			environment: "production",
			resources: [redactedPass],
			version: 1,
		});
		const parsed = parseStateFile(wire, "state.production.json");
		assert(parsed.success);

		expect(parsed.data).not.toContainKey("realDisplay");
	});

	it("should round-trip the realDisplay map through serialize and parse", () => {
		expect.assertions(1);

		const parsed = parseStateFile(serializeStateFile(stateWithRealDisplay), "state.dev.json");
		assert(parsed.success);

		expect(parsed.data).toStrictEqual(stateWithRealDisplay);
	});
});
