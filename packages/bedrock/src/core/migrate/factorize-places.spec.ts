import { describe, it } from "vitest";

import { asSha256Hex } from "../../types/ids.ts";
import { buildPlacesOverlay } from "./factorize-places.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";

const VALID_HASH = asSha256Hex("908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9");

function foldWithPlace(): EnvironmentFoldResult {
	return {
		badges: [],
		passes: [],
		places: new Map([
			[
				"start",
				{
					entry: { filePath: "place.rbxl" },
					fileHash: VALID_HASH,
					outputs: { versionNumber: 1 },
					placeId: "17613681043",
				},
			],
		]),
		products: [],
		universe: undefined,
		warnings: [],
	};
}

describe(buildPlacesOverlay, () => {
	it("should leave a field the environment omits out of the overlay even when the root sets it", ({
		expect,
	}) => {
		expect.assertions(1);

		const overlay = buildPlacesOverlay({
			fold: foldWithPlace(),
			label: undefined,
			rootPlaces: {
				start: {
					description: "Root.",
					displayName: "Root",
					filePath: "place.rbxl",
					serverSize: 10,
				},
			},
		});

		expect(overlay).toStrictEqual({ start: { placeId: "17613681043" } });
	});
});
