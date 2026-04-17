import type { GamePassConfigV2 } from "#src/resources/game-passes/wire";

/**
 * Builds a minimally-valid {@link GamePassConfigV2} wire body. Pass an
 * `overrides` object to tweak individual fields while keeping everything
 * else schema-compliant — useful for parser and integration tests that
 * only care about one field at a time.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validGamePassBody(overrides: Partial<GamePassConfigV2> = {}): GamePassConfigV2 {
	return {
		name: "Epic Pass",
		createdTimestamp: "2024-01-15T10:30:00.000Z",
		description: "Unlocks epic stuff",
		gamePassId: 12_345,
		iconAssetId: 67_890,
		isForSale: true,
		priceInformation: { defaultPriceInRobux: 100, enabledFeatures: [] },
		updatedTimestamp: "2024-03-20T14:45:00.000Z",
		...overrides,
	};
}
