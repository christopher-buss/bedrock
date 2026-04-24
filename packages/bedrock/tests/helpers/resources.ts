import type {
	GamePassDesiredState,
	PlaceDesiredState,
	ResourceCurrentState,
	UniverseDesiredState,
	UniverseManagedFlag,
} from "#src/core/resources";
import { UNIVERSE_MANAGED_FLAGS, UNIVERSE_SINGLETON_KEY } from "#src/core/resources";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "#src/types/ids";

/**
 * `it.for` rows for every platform-availability flag on the universe kind.
 * Derived from `UNIVERSE_MANAGED_FLAGS` so a newly-added managed flag is
 * picked up automatically; only `voiceChatEnabled` is filtered out, since
 * it is covered by its own explicit test cases.
 */
export const PLATFORM_FLAG_ROWS = UNIVERSE_MANAGED_FLAGS.filter(
	(flag): flag is Exclude<UniverseManagedFlag, "voiceChatEnabled"> => flag !== "voiceChatEnabled",
).map((flag) => [flag] as const);

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

/**
 * Builds a default {@link UniverseDesiredState} fixture. Pass an `overrides`
 * object to tweak individual fields without re-stating the defaults.
 *
 * @param overrides - Fields to override on the default fixture.
 * @returns A desired-state fixture with the overrides applied.
 */
export function universeDesired(overrides?: Partial<UniverseDesiredState>): UniverseDesiredState {
	return {
		key: UNIVERSE_SINGLETON_KEY,
		consoleEnabled: undefined,
		desktopEnabled: undefined,
		displayName: undefined,
		kind: "universe",
		mobileEnabled: undefined,
		tabletEnabled: undefined,
		universeId: asRobloxAssetId("1234567890"),
		visibility: undefined,
		voiceChatEnabled: undefined,
		vrEnabled: undefined,
		...overrides,
	};
}

/**
 * Builds a default {@link ResourceCurrentState} fixture for the `universe`
 * kind. Pass an `overrides` object to tweak individual fields without
 * re-stating the defaults.
 *
 * @param overrides - Fields to override on the default fixture.
 * @returns A current-state fixture with the overrides applied.
 */
export function universeCurrent(
	overrides?: Partial<ResourceCurrentState<"universe">>,
): ResourceCurrentState<"universe"> {
	return {
		...universeDesired(),
		outputs: { rootPlaceId: asRobloxAssetId("4711") },
		...overrides,
	};
}
