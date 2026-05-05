/**
 * Pricing feature flags that can be enabled on a game pass. Values
 * mirror the Open Cloud `GamePasses.PricingFeature` enum.
 */
export type GamePassPricingFeature =
	| "Invalid"
	| "PriceOptimization"
	| "RegionalPricing"
	| "UserFixedPrice";

/**
 * Public shape of a game pass's pricing configuration.
 */
export interface GamePassPrice {
	/** Default Robux price; `undefined` when no default price is configured. */
	readonly defaultPriceInRobux: number | undefined;
	/** Pricing feature flags currently enabled on this game pass. */
	readonly enabledFeatures: ReadonlyArray<GamePassPricingFeature>;
}

/**
 * A Roblox game pass as exposed to SDK consumers. Fields use DX-friendly
 * names and types (stringified IDs, `Date` timestamps) rather than the
 * raw wire representation.
 */
export interface GamePass {
	/** Stringified game pass ID. The API returns an int64; always use this. */
	readonly id: string;
	/** Display name of the game pass. */
	readonly name: string;
	/** ISO timestamp at which the game pass was created, as a `Date`. */
	readonly createdAt: Date;
	/** Consumer-facing description shown on the store listing. */
	readonly description: string;
	/** Icon asset ID as a string; `undefined` when no icon is uploaded. */
	readonly iconAssetId: string | undefined;
	/** Whether the game pass is currently purchasable. */
	readonly isForSale: boolean;
	/** Pricing configuration; `undefined` when pricing is not yet set. */
	readonly price: GamePassPrice | undefined;
	/** ISO timestamp of the most recent update, as a `Date`. */
	readonly updatedAt: Date;
}

/**
 * Parameters for creating a new game pass under a universe.
 */
export interface CreateGamePassParameters {
	/** Display name of the new game pass. */
	readonly name: string;
	/** Optional consumer-facing description shown on the store listing. */
	readonly description?: string;
	/** Optional icon image uploaded with the new game pass. */
	readonly imageFile?: Blob | Uint8Array;
	/** Whether the game pass should be purchasable immediately. */
	readonly isForSale?: boolean;
	/** Whether regional pricing should be enabled at creation time. */
	readonly isRegionalPricingEnabled?: boolean;
	/** Optional default price in Robux at creation time. */
	readonly price?: number;
	/** Stringified ID of the universe that owns the game pass. */
	readonly universeId: string;
}

/**
 * Parameters for reading a single game pass by ID.
 */
export interface GetGamePassParameters {
	/** Stringified ID of the game pass to retrieve. */
	readonly gamePassId: string;
	/** Stringified ID of the universe that owns the game pass. */
	readonly universeId: string;
}

/**
 * Parameters for partially updating an existing game pass. Every field
 * except the identifiers is optional; omitted fields are not included
 * in the multipart body so the server leaves their current values
 * untouched.
 */
export interface UpdateGamePassParameters {
	/** Optional new display name for the game pass. */
	readonly name?: string;
	/** Optional new consumer-facing description shown on the store listing. */
	readonly description?: string;
	/** Stringified ID of the game pass to update. */
	readonly gamePassId: string;
	/** Optional replacement icon image. */
	readonly imageFile?: Blob | Uint8Array;
	/** Optional new value for whether the game pass is purchasable. */
	readonly isForSale?: boolean;
	/** Optional new value for whether regional pricing is enabled. */
	readonly isRegionalPricingEnabled?: boolean;
	/** Optional new default price in Robux. */
	readonly price?: number;
	/** Stringified ID of the universe that owns the game pass. */
	readonly universeId: string;
}
