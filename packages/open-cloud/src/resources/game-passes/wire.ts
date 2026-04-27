// Mirrors GamePassConfigV2 from vendor/roblox-openapi.json.
// Internal to the subpath — not re-exported from index.ts.
//
// Nullable-but-required OpenAPI fields are modelled as `T | undefined`
// (value required, may be undefined) to comply with `unicorn/no-null`.
// Genuinely optional fields use `?:`. The parser normalizes any JSON
// `null` values to `undefined` at validation time so callers only ever
// observe `undefined`.

import type { PriceInformationLike } from "../../internal/price-information.ts";

/**
 * Wire-level pricing feature flag, mirroring `GamePasses.PricingFeature`.
 */
export type PricingFeatureWire =
	| "Invalid"
	| "PriceOptimization"
	| "RegionalPricing"
	| "UserFixedPrice";

/**
 * Wire shape of `GamePasses.PriceInformationStruct`.
 */
export type PriceInformationStructWire = PriceInformationLike<PricingFeatureWire>;

/**
 * Wire shape of `GamePassConfigV2` — the response body returned by the
 * Game Passes read endpoint.
 */
export interface GamePassConfigV2 {
	/** Display name of the game pass. */
	readonly name: string;
	/** ISO timestamp at which the game pass was created (`date-time`). */
	readonly createdTimestamp: string;
	/** Consumer-facing description. */
	readonly description: string;
	/** Int64 game pass ID, serialized as a JSON number. */
	readonly gamePassId: number;
	/** Int64 icon asset ID; `0` signals the pass has no icon uploaded. */
	readonly iconAssetId: number;
	/** Whether the game pass is currently purchasable. */
	readonly isForSale: boolean;
	/** Pricing block; `undefined` when the schema returns null. */
	readonly priceInformation: PriceInformationStructWire | undefined;
	/** ISO timestamp of the most recent update (`date-time`). */
	readonly updatedTimestamp: string;
}
