// Mirrors GamePassConfigV2 from vendor/roblox-openapi.json.
// Internal to the subpath — not re-exported from index.ts.
//
// Nullable-but-required OpenAPI fields are modelled as `T | undefined`
// (value required, may be undefined) to comply with `unicorn/no-null`.
// Genuinely optional fields use `?:`. The parser normalizes any JSON
// `null` values to `undefined` at validation time so callers only ever
// observe `undefined`.

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
export interface PriceInformationStructWire {
	/** Default Robux price; `undefined` when the schema returns null. */
	readonly defaultPriceInRobux: number | undefined;
	/** Enabled pricing feature flags, in the order returned by the API. */
	readonly enabledFeatures: ReadonlyArray<PricingFeatureWire>;
}

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

/**
 * Wire-level error code union for the Game Passes API, mirroring
 * `GamePasses.ErrorCode` exactly.
 */
export type ErrorCodeWire =
	| "ActiveInPO"
	| "AssetCreationFailure"
	| "AssetNotFound"
	| "BadRequest"
	| "Blocked"
	| "CommissionRateNotFound"
	| "FileTooLarge"
	| "InternalError"
	| "InvalidCount"
	| "InvalidPageSize"
	| "MissingArgument"
	| "NotAuthenticated"
	| "NotForSale"
	| "NotFound"
	| "NotSameUniverse"
	| "PassAlreadyRevoked"
	| "PassNotFound"
	| "PassRevokeFailure"
	| "PricingConfigError"
	| "SalesNotFound"
	| "TargetUnauthorizedAccess"
	| "UnauthorizedAccess"
	| "UniverseNotFound";

/**
 * Wire shape of `GamePasses.ErrorResponse`, the body returned for
 * non-2xx Game Passes API responses.
 *
 * Every field is optional per the schema. Unlike the success-path
 * types above, error bodies are consumed raw by the HTTP layer (see
 * `extractErrorCode` in `internal/http/fetch-client.ts`) rather than
 * normalized through a parser, so each field may arrive as absent,
 * as explicit JSON `null`, or as a value. Real 4xx responses tend to
 * include every key and set irrelevant ones to `null` (e.g. `hint` on
 * a 404). Consumers that read these fields should treat absent and
 * `null` as equivalent.
 */
export interface GamePassesErrorResponse {
	/** Machine-readable error code from the enum above. */
	readonly errorCode?: ErrorCodeWire;
	/** Human-readable error description. */
	readonly errorMessage?: string;
	/** Field that triggered the error; the API formats this as `"<entity>: <id>"`. */
	readonly field?: string;
	/** Suggested remediation, when provided by the API. */
	readonly hint?: string;
}
