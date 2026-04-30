// Mirrors DeveloperProductConfigV2 from vendor/roblox-openapi.json.
// Internal to the subpath; not re-exported from index.ts.
//
// Nullable-but-required OpenAPI fields are modelled as `T | undefined`
// (value required, may be undefined) to comply with `unicorn/no-null`.
// Genuinely optional fields use `?:`. The parser normalizes any JSON
// `null` values to `undefined` at validation time so callers only ever
// observe `undefined`.

import type { PriceInformationLike } from "../../../internal/price-information.ts";

/**
 * Wire-level pricing feature flag, mirroring `DeveloperProducts.PricingFeature`.
 */
export type DeveloperProductPricingFeatureWire =
	| "Invalid"
	| "PriceOptimization"
	| "RegionalPricing"
	| "UserFixedPrice";

/**
 * Wire shape of `DeveloperProductConfigV2`: the response body returned by
 * the developer-products read and create endpoints.
 */
export interface DeveloperProductConfigV2 {
	/** Display name of the developer product. */
	readonly name: string;
	/** ISO timestamp at which the developer product was created (`date-time`). */
	readonly createdTimestamp: string;
	/** Consumer-facing description shown on the storefront. */
	readonly description: string;
	/** Int64 icon image asset ID; `undefined` when no icon is uploaded. */
	readonly iconImageAssetId: number | undefined;
	/** Whether the developer product is currently purchasable. */
	readonly isForSale: boolean;
	/** Whether the developer product is locked from configuration changes. */
	readonly isImmutable: boolean;
	/** Pricing block; `undefined` when the schema returns null. */
	readonly priceInformation: DeveloperProductPriceInformationWire | undefined;
	/** Int64 developer product ID, serialized as a JSON number. */
	readonly productId: number;
	/** Whether the developer product appears on the external store page. */
	readonly storePageEnabled: boolean;
	/** Int64 universe ID that owns the developer product. */
	readonly universeId: number;
	/** ISO timestamp of the most recent update (`date-time`). */
	readonly updatedTimestamp: string;
}

/**
 * Wire shape of `DeveloperProducts.PriceInformationStruct`.
 */
type DeveloperProductPriceInformationWire =
	PriceInformationLike<DeveloperProductPricingFeatureWire>;
