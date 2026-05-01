/**
 * Pricing feature flags that can be enabled on a developer product. Values
 * mirror the Open Cloud `DeveloperProducts.PricingFeature` enum.
 */
export type DeveloperProductPricingFeature =
	| "Invalid"
	| "PriceOptimization"
	| "RegionalPricing"
	| "UserFixedPrice";

/**
 * Public shape of a developer product's pricing configuration.
 */
export interface DeveloperProductPrice {
	/** Default Robux price; `undefined` when no default price is configured. */
	readonly defaultPriceInRobux: number | undefined;
	/** Pricing feature flags currently enabled on this developer product. */
	readonly enabledFeatures: ReadonlyArray<DeveloperProductPricingFeature>;
}

/**
 * A Roblox developer product as exposed to SDK consumers. Fields use
 * DX-friendly names and types (stringified IDs, `Date` timestamps) rather
 * than the raw wire representation.
 */
export interface DeveloperProduct {
	/** Stringified developer product ID. The API returns an int64; always use this. */
	readonly id: string;
	/** Display name of the developer product. */
	readonly name: string;
	/** ISO timestamp at which the developer product was created, as a `Date`. */
	readonly createdAt: Date;
	/** Consumer-facing description shown on the storefront. */
	readonly description: string;
	/** Icon image asset ID as a string; `undefined` when no icon is uploaded. */
	readonly iconImageAssetId: string | undefined;
	/** Whether the developer product is currently purchasable. */
	readonly isForSale: boolean;
	/** Whether the developer product is locked from configuration changes. */
	readonly isImmutable: boolean;
	/** Pricing configuration; `undefined` when pricing is not yet set. */
	readonly price: DeveloperProductPrice | undefined;
	/** Whether the developer product appears on the external store page. */
	readonly storePageEnabled: boolean;
	/** Stringified ID of the universe that owns the developer product. */
	readonly universeId: string;
	/** ISO timestamp of the most recent update, as a `Date`. */
	readonly updatedAt: Date;
}

/**
 * Parameters for creating a new developer product under a universe.
 */
export interface CreateDeveloperProductParameters {
	/** Display name of the new developer product. */
	readonly name: string;
	/** Optional consumer-facing description shown on the storefront. */
	readonly description?: string;
	/** Optional icon image uploaded with the new developer product. */
	readonly imageFile?: Blob | Uint8Array;
	/** Whether the developer product should be purchasable immediately. */
	readonly isForSale?: boolean;
	/** Whether regional pricing should be enabled at creation time. */
	readonly isRegionalPricingEnabled?: boolean;
	/** Optional default price in Robux at creation time. */
	readonly price?: number;
	/** Stringified ID of the universe that owns the developer product. */
	readonly universeId: string;
}

/**
 * Parameters for reading a single developer product by ID.
 */
export interface GetDeveloperProductParameters {
	/** Stringified ID of the developer product to retrieve. */
	readonly productId: string;
	/** Stringified ID of the universe that owns the developer product. */
	readonly universeId: string;
}

/**
 * Parameters for partially updating an existing developer product. Every
 * field except the identifiers is optional; omitted fields are not included
 * in the multipart PATCH body so the server leaves their current values
 * untouched.
 */
export interface UpdateDeveloperProductParameters {
	/** Optional new display name. */
	readonly name?: string;
	/** Optional new consumer-facing description. */
	readonly description?: string;
	/** Optional replacement icon image upload. */
	readonly imageFile?: Blob | Uint8Array;
	/** Optional flag toggling whether the product is purchasable. */
	readonly isForSale?: boolean;
	/** Optional flag toggling regional pricing. */
	readonly isRegionalPricingEnabled?: boolean;
	/** Optional new default price in Robux. */
	readonly price?: number;
	/** Stringified ID of the developer product to update. */
	readonly productId: string;
	/** Optional flag toggling visibility on the external store page. */
	readonly storePageEnabled?: boolean;
	/** Stringified ID of the universe that owns the developer product. */
	readonly universeId: string;
}
