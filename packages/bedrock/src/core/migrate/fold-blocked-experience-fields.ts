import { blockedWarning, type FoldFragment, isObjectPayload } from "./fold-universe-shared.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const EXPERIENCE_KIND = "experience";
const EXPERIENCE_CONFIGURATION_KIND = "experienceConfiguration";
const UNIVERSE_AVATAR_PREFIX = "universeAvatar";
const UNIVERSE_AVATAR_REASON = "avatar configuration has no Open Cloud equivalent";
const GROUP_ID_REASON = "Open Cloud does not support transferring experience ownership";

interface BlockedFieldRule {
	readonly field: string;
	readonly reason: string;
}

/**
 * `experienceConfiguration_singleton` fields with no Open Cloud writable
 * endpoint. `isFriendsOnly` is intentionally omitted: `foldVisibility`
 * already owns it, and listing it here would double-emit when
 * `experienceActivation_singleton.isActive` is `true` and the cross-fold
 * blocks the public-friends combo.
 */
const BLOCKED_FIELDS: ReadonlyArray<BlockedFieldRule> = [
	{ field: "genre", reason: "Roblox does not expose `genre` via Open Cloud" },
	{ field: "isForSale", reason: "paid-access flag has no Open Cloud equivalent" },
	{ field: "price", reason: "paid-access flag has no Open Cloud equivalent" },
	{
		field: "studioAccessToApisAllowed",
		reason: "Open Cloud does not currently expose a write endpoint for studio API access",
	},
	{
		field: "permissions",
		reason: "experienceConfiguration.permissions has no Open Cloud equivalent",
	},
	{ field: "isArchived", reason: "isArchived has no Open Cloud equivalent" },
];

/**
 * Emit one `blocked` `MigrationWarning` per non-`undefined` legacy-only
 * field on the experience-side Mantle resources: every entry in the
 * static `BLOCKED_FIELDS` table on `experienceConfiguration_singleton`,
 * any key under the `universeAvatar` prefix, and `groupId` on
 * `experience_singleton`. The Mantle null sentinel (`~`) is normalized
 * to `undefined` by `parseState`, so absent and null fields both skip.
 *
 * The fragment's `entryFragment` is always empty; this fold contributes
 * only warnings, and the `warnings` array is empty when none of the
 * watched resources have a populated blocked field.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns A fragment whose warnings list every blocked field present.
 */
export function foldBlockedExperienceFields(
	resources: ReadonlyArray<MantleResource>,
): FoldFragment {
	return {
		entryFragment: {},
		warnings: [...configurationWarnings(resources), ...groupIdWarnings(resources)],
	};
}

function groupIdWarnings(
	resources: ReadonlyArray<MantleResource>,
): ReadonlyArray<MigrationWarning> {
	const experience = resources.find((resource) => resource.kind === EXPERIENCE_KIND);
	if (
		experience === undefined ||
		!isObjectPayload(experience.inputs) ||
		experience.inputs["groupId"] === undefined
	) {
		return [];
	}

	return [blockedWarning("experience_singleton.groupId", GROUP_ID_REASON)];
}

function staticFieldWarnings(inputs: Record<string, unknown>): ReadonlyArray<MigrationWarning> {
	return BLOCKED_FIELDS.flatMap((rule) => {
		if (inputs[rule.field] === undefined) {
			return [];
		}

		return [blockedWarning(`experienceConfiguration_singleton.${rule.field}`, rule.reason)];
	});
}

function avatarFieldWarnings(inputs: Record<string, unknown>): ReadonlyArray<MigrationWarning> {
	return Object.keys(inputs)
		.filter((key) => key.startsWith(UNIVERSE_AVATAR_PREFIX) && inputs[key] !== undefined)
		.map((key) =>
			blockedWarning(`experienceConfiguration_singleton.${key}`, UNIVERSE_AVATAR_REASON),
		);
}

function configurationWarnings(
	resources: ReadonlyArray<MantleResource>,
): ReadonlyArray<MigrationWarning> {
	const config = resources.find((resource) => resource.kind === EXPERIENCE_CONFIGURATION_KIND);
	if (config === undefined || !isObjectPayload(config.inputs)) {
		return [];
	}

	return [...staticFieldWarnings(config.inputs), ...avatarFieldWarnings(config.inputs)];
}
