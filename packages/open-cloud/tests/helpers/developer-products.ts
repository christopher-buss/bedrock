import type { DeveloperProductConfigV2 } from "#src/resources/developer-products/wire";

/**
 * Builds a minimally-valid {@link DeveloperProductConfigV2} wire body. Pass
 * an `overrides` object to tweak individual fields while keeping everything
 * else schema-compliant — useful for parser and integration tests that
 * only care about one field at a time.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validDeveloperProductBody(
	overrides: Partial<DeveloperProductConfigV2> = {},
): DeveloperProductConfigV2 {
	return {
		name: "Gem Pack",
		createdTimestamp: "2024-01-15T10:30:00.000Z",
		description: "A premium gem pack",
		iconImageAssetId: 67_890,
		isForSale: true,
		isImmutable: false,
		priceInformation: { defaultPriceInRobux: 100, enabledFeatures: [] },
		productId: 12_345,
		storePageEnabled: true,
		universeId: 999,
		updatedTimestamp: "2024-03-20T14:45:00.000Z",
		...overrides,
	};
}
