import type {
	GamePassDesiredState,
	PlaceDesiredState,
	ResourceCurrentState,
} from "#src/core/resources";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "#src/types/ids";

const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

const PLACE_HASH = asSha256Hex("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");

/**
 * Builds a default {@link GamePassDesiredState} fixture. Pass an `overrides`
 * object to tweak individual fields without re-stating the defaults.
 *
 * @param overrides - Fields to override on the default fixture.
 * @returns A desired-state fixture with the overrides applied.
 */
export function gamePassDesired(overrides?: Partial<GamePassDesiredState>): GamePassDesiredState {
	return {
		key: asResourceKey("vip-pass"),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		iconFileHash: ICON_HASH,
		iconFilePath: "assets/vip-icon.png",
		kind: "gamePass",
		price: 500,
		...overrides,
	};
}

/**
 * Builds a default {@link ResourceCurrentState} fixture for the `gamePass`
 * kind. Pass an `overrides` object to tweak individual fields without
 * re-stating the defaults.
 *
 * @param overrides - Fields to override on the default fixture.
 * @returns A current-state fixture with the overrides applied.
 */
export function gamePassCurrent(
	overrides?: Partial<ResourceCurrentState<"gamePass">>,
): ResourceCurrentState<"gamePass"> {
	return {
		...gamePassDesired(),
		outputs: {
			assetId: asRobloxAssetId("9876543210"),
			iconAssetId: asRobloxAssetId("1122334455"),
		},
		...overrides,
	};
}

/**
 * Builds a default {@link PlaceDesiredState} fixture. Pass an `overrides`
 * object to tweak individual fields without re-stating the defaults.
 *
 * @param overrides - Fields to override on the default fixture.
 * @returns A desired-state fixture with the overrides applied.
 */
export function placeDesired(overrides?: Partial<PlaceDesiredState>): PlaceDesiredState {
	return {
		key: asResourceKey("start-place"),
		fileHash: PLACE_HASH,
		filePath: "places/start.rbxl",
		kind: "place",
		placeId: asRobloxAssetId("4711"),
		...overrides,
	};
}

/**
 * Builds a default {@link ResourceCurrentState} fixture for the `place` kind.
 * Pass an `overrides` object to tweak individual fields without re-stating
 * the defaults.
 *
 * @param overrides - Fields to override on the default fixture.
 * @returns A current-state fixture with the overrides applied.
 */
export function placeCurrent(
	overrides?: Partial<ResourceCurrentState<"place">>,
): ResourceCurrentState<"place"> {
	return {
		...placeDesired(),
		outputs: { versionNumber: 1 },
		...overrides,
	};
}
