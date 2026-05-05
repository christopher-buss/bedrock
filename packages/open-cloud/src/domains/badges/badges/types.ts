/**
 * Awarder kind for a badge. The Roblox API only awards badges from a
 * `Place`, so the wire enum carries a single value; the public type
 * preserves the string label so future awarder kinds can be added
 * without a breaking change.
 */
export type BadgeAwarderType = "Place";

/**
 * The entity that awards a badge. Always a place at present; the
 * `id` is the awarding place's ID and `name` its display name.
 */
export interface BadgeAwarder {
	/** Stringified ID of the awarding entity. */
	readonly id: string;
	/** Display name of the awarding entity. */
	readonly name: string;
	/** Kind of awarding entity. Currently always `"Place"`. */
	readonly type: BadgeAwarderType;
}

/**
 * Award statistics for a badge.
 */
export interface BadgeStatistics {
	/** Total number of times the badge has been awarded. */
	readonly awardedCount: number;
	/** Number of times the badge has been awarded in the past day. */
	readonly pastDayAwardedCount: number;
	/** Win rate, as a percentage between 0 and 100. */
	readonly winRatePercentage: number;
}

/**
 * A Roblox badge as exposed to SDK consumers. Fields use DX-friendly
 * names and types (stringified IDs, `Date` timestamps) rather than the
 * raw wire representation.
 */
export interface Badge {
	/** Stringified badge ID. The API returns an int64; always use this. */
	readonly id: string;
	/** Source-language name shown when no localized override applies. */
	readonly name: string;
	/** Awarding entity for the badge. */
	readonly awarder: BadgeAwarder;
	/** ISO timestamp at which the badge was created, as a `Date`. */
	readonly createdAt: Date;
	/** Source-language description shown when no localized override applies. */
	readonly description: string;
	/** Resolved description for the requesting locale, or the source description. */
	readonly displayDescription: string;
	/** Resolved icon image asset ID for the requesting locale; `undefined` when no icon is uploaded. */
	readonly displayIconImageId: string | undefined;
	/** Resolved name for the requesting locale, or the source name. */
	readonly displayName: string;
	/** Whether the badge is currently active. Disabled badges cannot be awarded. */
	readonly enabled: boolean;
	/** Source-language icon image asset ID; `undefined` when no icon is uploaded. */
	readonly iconImageId: string | undefined;
	/** Award statistics for the badge. */
	readonly statistics: BadgeStatistics;
	/** ISO timestamp of the most recent update, as a `Date`. */
	readonly updatedAt: Date;
}
