import { describe, expect, it } from "vitest";

import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import type { ResourceDesiredInput } from "./flatten.ts";
import { needsArtifact } from "./needs-artifact.ts";

function placeInput(filePath: string | undefined): ResourceDesiredInput {
	return {
		key: asResourceKey("start-place"),
		description: undefined,
		displayName: undefined,
		filePath,
		kind: "place",
		placeId: asRobloxAssetId("4711"),
		serverSize: undefined,
	};
}

describe(needsArtifact, () => {
	it("should return true for a place that declares a file", () => {
		expect.assertions(1);

		expect(needsArtifact(placeInput("places/start.rbxl"))).toBeTrue();
	});

	it("should return false for a config-only place", () => {
		expect.assertions(1);

		expect(needsArtifact(placeInput(undefined))).toBeFalse();
	});

	it("should return false for a game pass, whose icon is not a build artifact", () => {
		expect.assertions(1);

		expect(
			needsArtifact({
				key: asResourceKey("vip-pass"),
				name: "VIP Pass",
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				kind: "gamePass",
				price: 500,
			}),
		).toBeFalse();
	});
});
