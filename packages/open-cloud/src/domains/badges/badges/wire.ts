// Mirrors Roblox.Web.Responses.Badges.BadgeResponseV2 and its component
// schemas from vendor/roblox-openapi.json. Internal to the subpath; not
// re-exported from index.ts.

/**
 * Wire shape of
 * `Roblox.Web.Responses.RelatedEntityTypeResponse_Roblox.Platform.Badges.BadgeAwarderType_`.
 */
export interface BadgeAwarderWire {
	/** Int64 awarder ID. */
	readonly id: number;
	/** Display name of the awarding entity. */
	readonly name: string;
	/** Numeric awarder kind. `1` is `Place`. */
	readonly type: BadgeAwarderTypeWire;
}

/**
 * Wire shape of `Roblox.Web.Responses.Badges.BadgeAwardStatisticsResponse`.
 */
export interface BadgeStatisticsWire {
	/** Int64 lifetime awarded count. */
	readonly awardedCount: number;
	/** Int64 awarded count over the past day. */
	readonly pastDayAwardedCount: number;
	/** Double win-rate percentage in the range `[0, 100]`. */
	readonly winRatePercentage: number;
}

/**
 * Wire shape of `Roblox.Web.Responses.Badges.BadgeResponseV2`: the response
 * body returned by the legacy badges create endpoint.
 */
export interface BadgeResponseV2Wire {
	/** Int64 badge ID, serialized as a JSON number. */
	readonly id: number;
	/** Display name of the badge. */
	readonly name: string;
	/** Awarding entity block. */
	readonly awarder: BadgeAwarderWire;
	/** ISO timestamp at which the badge was created (`date-time`). */
	readonly created: string;
	/** Source-language description. */
	readonly description: string;
	/** Resolved description for the requesting locale. */
	readonly displayDescription: string;
	/** Int64 resolved icon image asset ID; `0` signals no icon for this locale. */
	readonly displayIconImageId: number;
	/** Resolved name for the requesting locale. */
	readonly displayName: string;
	/** Whether the badge is currently active. Disabled badges cannot be awarded. */
	readonly enabled: boolean;
	/** Int64 source-language icon image asset ID; `0` signals no icon. */
	readonly iconImageId: number;
	/** Award statistics block. */
	readonly statistics: BadgeStatisticsWire;
	/** ISO timestamp of the most recent update (`date-time`). */
	readonly updated: string;
}

/**
 * Wire shape of `Roblox.Platform.Badges.BadgeAwarderType`.
 */
type BadgeAwarderTypeWire = 1;
