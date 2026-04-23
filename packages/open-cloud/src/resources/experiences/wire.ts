// Mirrors the `Universe` schema from vendor/roblox-openapi.json.
// Internal to the subpath -- not re-exported from index.ts.
//
// Nullable-but-required OpenAPI fields are modelled as `T | undefined`
// to comply with `unicorn/no-null`. Genuinely optional fields use `?:`.
// The parser normalizes any JSON `null` values to `undefined` at
// validation time so callers only ever observe `undefined`.

/**
 * Wire-level visibility enum, mirroring the `visibility` field of the
 * `Universe` schema.
 */
export type VisibilityWire = "PRIVATE" | "PUBLIC" | "VISIBILITY_UNSPECIFIED";

/**
 * Wire-level age-rating enum, mirroring the `ageRating` field of the
 * `Universe` schema.
 */
export type AgeRatingWire =
	| "AGE_RATING_9_PLUS"
	| "AGE_RATING_13_PLUS"
	| "AGE_RATING_17_PLUS"
	| "AGE_RATING_ALL"
	| "AGE_RATING_UNSPECIFIED";

/**
 * Wire shape of `Universe_SocialLink`.
 */
export interface SocialLinkWire {
	/** Display title for the link. */
	readonly title: string;
	/** Destination URI. */
	readonly uri: string;
}

/**
 * Wire shape of the `Universe` resource -- the response body returned
 * by both `Cloud_GetUniverse` and `Cloud_UpdateUniverse`. Genuinely
 * optional fields are `T | undefined` (rather than `T`) so callers
 * can simulate absence by setting a field to `undefined` under
 * `exactOptionalPropertyTypes`.
 */
export interface UniverseWire {
	/** Age-rating classification. */
	readonly ageRating: AgeRatingWire;
	/** Whether console players can join. */
	readonly consoleEnabled?: boolean | undefined;
	/** ISO timestamp when the universe was created (`date-time`). */
	readonly createTime: string;
	/** Description, derived from the root place's description. */
	readonly description: string;
	/** Whether desktop players can join. */
	readonly desktopEnabled?: boolean | undefined;
	/** Discord social link block. */
	readonly discordSocialLink?: SocialLinkWire | undefined;
	/** Display name, derived from the root place's name. */
	readonly displayName: string;
	/** Facebook social link block. */
	readonly facebookSocialLink?: SocialLinkWire | undefined;
	/** Group-owner resource path when the universe is group-owned. */
	readonly group?: string | undefined;
	/** Guilded social link block. */
	readonly guildedSocialLink?: SocialLinkWire | undefined;
	/** Whether mobile players can join. */
	readonly mobileEnabled?: boolean | undefined;
	/** Resource path, e.g. `"universes/{id}"`. */
	readonly path: string;
	/** Private server price in Robux; absent when private servers are disabled. */
	readonly privateServerPriceRobux?: number | undefined;
	/** Roblox Group social link block. */
	readonly robloxGroupSocialLink?: SocialLinkWire | undefined;
	/** Root place resource path, e.g. `"universes/{id}/places/{pid}"`. */
	readonly rootPlace?: string | undefined;
	/** Whether tablet players can join. */
	readonly tabletEnabled?: boolean | undefined;
	/** Twitch social link block. */
	readonly twitchSocialLink?: SocialLinkWire | undefined;
	/** Twitter social link block. */
	readonly twitterSocialLink?: SocialLinkWire | undefined;
	/** ISO timestamp of the most recent update (`date-time`). */
	readonly updateTime: string;
	/** User-owner resource path when the universe is user-owned. */
	readonly user?: string | undefined;
	/** Current visibility of the universe. */
	readonly visibility: VisibilityWire;
	/** Whether voice chat is enabled. */
	readonly voiceChatEnabled?: boolean | undefined;
	/** Whether VR players can join. */
	readonly vrEnabled?: boolean | undefined;
	/** Youtube social link block. */
	readonly youtubeSocialLink?: SocialLinkWire | undefined;
}
