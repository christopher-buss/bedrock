/**
 * Awarder kind for a badge. The Roblox API only awards badges from a
 * `Place`, so the wire enum carries a single value; the public type
 * preserves the string label so future awarder kinds can be added
 * without a breaking change.
 *
 * @since 0.1.0
 */
export type BadgeAwarderType = "Place";

/**
 * The entity that awards a badge. Always a place at present; the
 * `id` is the awarding place's ID and `name` its display name.
 *
 * @since 0.1.0
 */
export interface BadgeAwarder {
	/** Stringified ID of the awarding entity. */
	readonly id: string;
	/**
	 * Display name of the awarding entity, or `undefined` when the
	 * response omits it, as the create response does.
	 */
	readonly name: string | undefined;
	/** Kind of awarding entity. Currently always `"Place"`. */
	readonly type: BadgeAwarderType;
}

/**
 * Award statistics for a badge.
 *
 * @since 0.1.0
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
 * Source of funds for the Robux fee charged on badge creation.
 *
 * @since 0.1.0
 */
export type BadgePaymentSource = "Group" | "User";

/**
 * Parameters for creating a new badge under a universe.
 *
 * @since 0.1.0
 */
export interface CreateBadgeParameters {
	/** Display name of the new badge. */
	readonly name: string;
	/** Optional source-language description. */
	readonly description?: string;
	/** Optional confirmation of the Robux cost the caller expects to pay. */
	readonly expectedCost?: number;
	/** Icon image to upload as the badge's source-language icon. */
	readonly icon: Blob | Uint8Array;
	/** Whether the badge should be created in the active state. */
	readonly isActive?: boolean;
	/**
	 * Account that funds the badge creation fee. Defaults to user funds
	 * server-side.
	 */
	readonly paymentSource?: BadgePaymentSource;
	/** Stringified ID of the universe that owns the badge. */
	readonly universeId: string;
}

/**
 * Parameters for partially updating an existing badge. Every field
 * except the identifier is optional; omitted fields are not included
 * in the JSON body so the server leaves their current values untouched.
 *
 * @since 0.1.0
 */
export interface UpdateBadgeParameters {
	/** Optional new source-language display name. */
	readonly name?: string;
	/** Stringified ID of the badge to update. */
	readonly badgeId: string;
	/** Optional new source-language description. */
	readonly description?: string;
	/** Optional new enabled flag. */
	readonly enabled?: boolean;
}

/**
 * A Roblox badge as exposed to SDK consumers. Fields use DX-friendly
 * names and types (stringified IDs, `Date` timestamps) rather than the
 * raw wire representation.
 *
 * @since 0.1.0
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
	/**
	 * Resolved description for the requesting locale, or the source
	 * description.
	 */
	readonly displayDescription: string;
	/**
	 * Resolved icon image asset ID for the requesting locale; `undefined` when
	 * no icon is uploaded.
	 */
	readonly displayIconImageId: string | undefined;
	/** Resolved name for the requesting locale, or the source name. */
	readonly displayName: string;
	/**
	 * Whether the badge is currently active. Disabled badges cannot be
	 * awarded.
	 */
	readonly enabled: boolean;
	/**
	 * Source-language icon image asset ID; `undefined` when no icon is
	 * uploaded.
	 */
	readonly iconImageId: string | undefined;
	/** Award statistics for the badge. */
	readonly statistics: BadgeStatistics;
	/** ISO timestamp of the most recent update, as a `Date`. */
	readonly updatedAt: Date;
}

/**
 * The universe that awards a badge, as the badge read endpoints report it.
 *
 * @since 0.5.0
 */
export interface BadgeAwardingUniverse {
	/** Stringified universe ID. */
	readonly id: string;
	/** Universe display name. */
	readonly name: string;
	/** Stringified ID of the universe's root place. */
	readonly rootPlaceId: string;
}

/**
 * A badge as the unauthenticated read endpoints return it. These endpoints
 * name the awarding universe instead of the awarding place, so this shape
 * carries `awardingUniverse` where {@link Badge} carries `awarder`.
 *
 * @since 0.5.0
 */
export interface BadgeDetails extends Pick<Badge, Exclude<keyof Badge, "awarder">> {
	/** Universe that awards the badge. */
	readonly awardingUniverse: BadgeAwardingUniverse;
}

/**
 * Page sizes the badge list endpoint accepts.
 *
 * @since 0.5.0
 */
export type BadgePageSize = 10 | 25 | 50 | 100;

/**
 * Parameters for listing the badges of a universe. Pass the returned
 * `nextPageToken` as `pageToken` until it is undefined.
 *
 * @since 0.5.0
 */
export interface ListBadgesParameters {
	/** Optional page size; Roblox defaults to 10. */
	readonly pageSize?: BadgePageSize;
	/** Cursor returned by the previous page. */
	readonly pageToken?: string;
	/** Stringified universe ID. */
	readonly universeId: string;
}

/**
 * Parameters for reading one badge.
 *
 * @since 0.5.0
 */
export interface GetBadgeParameters {
	/** Stringified ID of the badge to read. */
	readonly badgeId: string;
}
