/**
 * Caller-supplied input for the `get` method on `ExperiencesClient`.
 */
export interface GetExperienceParameters {
	/** Stringified ID of the universe to fetch. */
	readonly universeId: string;
}

/**
 * A social link that may be associated with an experience.
 */
export interface SocialLink {
	/** Display title of the link. */
	readonly title: string;
	/** Destination URI. */
	readonly uri: string;
}

/**
 * Caller-supplied input for the `update` method on `ExperiencesClient`.
 * Every writable field is optional; presence of a key drives the
 * `updateMask` query string that the server uses as the field-mask for
 * the partial update. Absent keys are left untouched server-side.
 * Setting a key to `undefined` clears the corresponding server-side
 * value (applicable to `privateServerPriceRobux` and each optional
 * social link).
 */
export interface UpdateExperienceParameters {
	/** Whether console players can join. */
	readonly consoleEnabled?: boolean;
	/** Whether desktop players can join. */
	readonly desktopEnabled?: boolean;
	/** Discord social link block; `undefined` clears the server value. */
	readonly discordSocialLink?: SocialLink | undefined;
	/** Facebook social link block; `undefined` clears the server value. */
	readonly facebookSocialLink?: SocialLink | undefined;
	/** Guilded social link block; `undefined` clears the server value. */
	readonly guildedSocialLink?: SocialLink | undefined;
	/** Whether mobile players can join. */
	readonly mobileEnabled?: boolean;
	/** Private-server price in Robux; `undefined` disables private servers. */
	readonly privateServerPriceRobux?: number | undefined;
	/** Roblox Group social link block; `undefined` clears the server value. */
	readonly robloxGroupSocialLink?: SocialLink | undefined;
	/** Whether tablet players can join. */
	readonly tabletEnabled?: boolean;
	/** Twitch social link block; `undefined` clears the server value. */
	readonly twitchSocialLink?: SocialLink | undefined;
	/** Twitter social link block; `undefined` clears the server value. */
	readonly twitterSocialLink?: SocialLink | undefined;
	/** Stringified ID of the universe to update. */
	readonly universeId: string;
	/** Whether voice chat is enabled. */
	readonly voiceChatEnabled?: boolean;
	/** Whether VR players can join. */
	readonly vrEnabled?: boolean;
	/** Youtube social link block; `undefined` clears the server value. */
	readonly youtubeSocialLink?: SocialLink | undefined;
}

/**
 * Discriminated-union representation of an experience's owner.
 */
export interface ExperienceOwner {
	/** Stringified owner ID. */
	readonly id: string;
	/** Whether the owner is a user or a group. */
	readonly kind: "group" | "user";
}

/** Public visibility classification. */
export type ExperienceVisibility = "private" | "public" | "unspecified";

/** Public age-rating classification. */
export type ExperienceAgeRating = "9Plus" | "13Plus" | "17Plus" | "all" | "unspecified";

/**
 * Parsed representation of a Roblox experience's configuration.
 */
export interface Experience {
	/** Stringified universe ID, extracted from the wire `path`. */
	readonly id: string;
	/** Age-rating classification. */
	readonly ageRating: ExperienceAgeRating;
	/** Whether console players can join. */
	readonly consoleEnabled: boolean;
	/** Timestamp when the universe was created. */
	readonly createdAt: Date;
	/** Long-form description of the experience. */
	readonly description: string;
	/** Whether desktop players can join. */
	readonly desktopEnabled: boolean;
	/** Discord social link; `undefined` when absent. */
	readonly discordSocialLink: SocialLink | undefined;
	/** Display name of the experience. */
	readonly displayName: string;
	/** Facebook social link; `undefined` when absent. */
	readonly facebookSocialLink: SocialLink | undefined;
	/** Guilded social link; `undefined` when absent. */
	readonly guildedSocialLink: SocialLink | undefined;
	/** Whether mobile players can join. */
	readonly mobileEnabled: boolean;
	/** Owner of the universe (user or group). */
	readonly owner: ExperienceOwner;
	/** Private server price in Robux; `undefined` when not supported. */
	readonly privateServerPriceRobux: number | undefined;
	/** Roblox Group social link; `undefined` when absent. */
	readonly robloxGroupSocialLink: SocialLink | undefined;
	/** Root place ID; `undefined` when the universe has no resolved root place. */
	readonly rootPlaceId: string | undefined;
	/** Whether tablet players can join. */
	readonly tabletEnabled: boolean;
	/** Twitch social link; `undefined` when absent. */
	readonly twitchSocialLink: SocialLink | undefined;
	/** Twitter social link; `undefined` when absent. */
	readonly twitterSocialLink: SocialLink | undefined;
	/** Timestamp of the most recent update. */
	readonly updatedAt: Date;
	/** Visibility classification. */
	readonly visibility: ExperienceVisibility;
	/** Whether voice chat is enabled. */
	readonly voiceChatEnabled: boolean;
	/** Whether VR players can join. */
	readonly vrEnabled: boolean;
	/** Youtube social link; `undefined` when absent. */
	readonly youtubeSocialLink: SocialLink | undefined;
}
