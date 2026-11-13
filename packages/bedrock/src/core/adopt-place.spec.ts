import { describe, it } from "vitest";

import { gamePassCurrent, placeCurrent } from "#tests/helpers/resources";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { adoptablePlaces } from "./adopt-place.ts";
import type { ResourceDesiredInput } from "./flatten.ts";

function place(
	key: string,
	{ filePath, placeId }: { readonly filePath?: string; readonly placeId: string },
): ResourceDesiredInput {
	return {
		key: asResourceKey(key),
		description: undefined,
		displayName: "Lobby",
		filePath,
		kind: "place",
		placeId: asRobloxAssetId(placeId),
		serverSize: undefined,
	};
}

describe(adoptablePlaces, () => {
	it("should adopt only config-only places that no saved place tracks by Key or ID", ({
		expect,
	}) => {
		expect.assertions(1);

		const adoptable = adoptablePlaces(
			[
				place("lobby", { placeId: "1" }),
				place("arena", { filePath: "places/arena.rbxl", placeId: "2" }),
				place("hub", { placeId: "3" }),
				place("renamed", { placeId: "4" }),
				{ key: asResourceKey("old"), kind: "place", retired: true },
			],
			[
				gamePassCurrent({ key: asResourceKey("lobby") }),
				placeCurrent({ key: asResourceKey("hub"), placeId: asRobloxAssetId("9") }),
				placeCurrent({ key: asResourceKey("start"), placeId: asRobloxAssetId("4") }),
			],
		);

		expect(adoptable).toStrictEqual([
			{
				key: "lobby",
				description: undefined,
				displayName: "Lobby",
				fileHash: undefined,
				filePath: undefined,
				kind: "place",
				placeId: "1",
				serverSize: undefined,
			},
		]);
	});
});
