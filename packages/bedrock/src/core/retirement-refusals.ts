/** Reason every universe retirement or orphaned universe is refused. */
export const UNIVERSE_REMOVAL_UNAVAILABLE = "Universe removal is not available at this time.";

/**
 * Explain why the root place cannot be retired.
 *
 * @param key - Config key of the root place.
 * @param placeId - Roblox place ID of the root place.
 * @returns The refusal message.
 */
export function rootPlaceRetirementRefusal(key: string, placeId: string): string {
	return `Cannot retire root place '${key}' (${placeId}): Roblox derives the experience name and description from it.`;
}

/** Reason every badge retirement, untrack, or orphaned badge is refused. */
export const BADGE_RETIREMENT_UNAVAILABLE = "Badge retirement is not available at this time.";
