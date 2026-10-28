import type { BadgeEntry, EnvironmentEntry } from "../schema.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";

type BadgeOverlayEntry = NonNullable<EnvironmentEntry["badges"]>[string];

/**
 * Project the primary environment's badge folds into bedrock's root
 * `badges` block. Every badge field Mantle records is required on the fold,
 * so the primary's values land on root verbatim and other environments
 * record their divergence through {@link buildBadgesOverlay}.
 *
 * @param primaryFold - The chosen primary environment's fold.
 * @returns The root `badges` block, or `undefined` when the primary has no
 *   badges.
 */
export function buildRootBadges(
	primaryFold: EnvironmentFoldResult,
): Record<string, BadgeEntry> | undefined {
	if (primaryFold.badges.length === 0) {
		return undefined;
	}

	return Object.fromEntries(primaryFold.badges.map(({ key, entry }) => [key, entry]));
}

/**
 * Build the per-environment overlay for `badges`. A badge the primary also
 * declares carries only the fields whose values differ from the primary; a
 * badge only this environment declares carries every field.
 *
 * @param fold - The per-environment fold whose badges are being overlaid.
 * @param primary - The primary environment's fold.
 * @returns The overlay `badges` block, or `undefined` when no badge
 *   diverges from the primary.
 */
export function buildBadgesOverlay(
	fold: EnvironmentFoldResult,
	primary: EnvironmentFoldResult,
): Record<string, BadgeOverlayEntry> | undefined {
	const primaryByKey = new Map<string, BadgeEntry>(
		primary.badges.map(({ key, entry }) => [key, entry]),
	);
	const overlay: Record<string, BadgeOverlayEntry> = {};
	for (const { key, entry } of fold.badges) {
		const badgeOverlay = diffBadge(entry, primaryByKey.get(key));
		if (Object.keys(badgeOverlay).length > 0) {
			overlay[key] = badgeOverlay;
		}
	}

	return Object.keys(overlay).length === 0 ? undefined : overlay;
}

function diffBadge(entry: BadgeEntry, primary: BadgeEntry | undefined): BadgeOverlayEntry {
	return {
		...(!Object.is(entry.name, primary?.name) ? { name: entry.name } : {}),
		...(!Object.is(entry.description, primary?.description)
			? { description: entry.description }
			: {}),
		...(!Object.is(entry.enabled, primary?.enabled) ? { enabled: entry.enabled } : {}),
		...(!Object.is(entry.icon["en-us"], primary?.icon["en-us"]) ? { icon: entry.icon } : {}),
	};
}
