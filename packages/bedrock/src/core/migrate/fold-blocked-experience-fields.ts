import {
	blockedWarning,
	EMPTY_FRAGMENT,
	type FoldFragment,
	isObjectPayload,
} from "./fold-universe-shared.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const EXPERIENCE_CONFIGURATION_KIND = "experienceConfiguration";
const UNIVERSE_AVATAR_PREFIX = "universeAvatar";
const UNIVERSE_AVATAR_REASON = "avatar configuration has no Open Cloud equivalent";

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
 * Emit one `blocked` `MigrationWarning` per non-`undefined` field of
 * `experienceConfiguration_singleton.inputs` that has no Open Cloud
 * writable endpoint. The Mantle null sentinel (`~`) is normalized to
 * `undefined` by `parseState`, so absent and null fields both skip.
 *
 * Returns `EMPTY_FRAGMENT` when no `experienceConfiguration` resource is
 * present or its `inputs` payload is not a plain object. The fragment's
 * `entryFragment` is always empty; this fold contributes only warnings.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns A fragment whose warnings list every blocked field present.
 */
export function foldBlockedExperienceFields(
	resources: ReadonlyArray<MantleResource>,
): FoldFragment {
	const config = resources.find((resource) => resource.kind === EXPERIENCE_CONFIGURATION_KIND);
	if (config === undefined || !isObjectPayload(config.inputs)) {
		return EMPTY_FRAGMENT;
	}

	const { inputs } = config;
	const staticWarnings: ReadonlyArray<MigrationWarning> = BLOCKED_FIELDS.flatMap((rule) => {
		if (inputs[rule.field] === undefined) {
			return [];
		}

		return [blockedWarning(`experienceConfiguration_singleton.${rule.field}`, rule.reason)];
	});

	const avatarWarnings: ReadonlyArray<MigrationWarning> = Object.keys(inputs)
		.filter((key) => key.startsWith(UNIVERSE_AVATAR_PREFIX) && inputs[key] !== undefined)
		.map((key) =>
			blockedWarning(`experienceConfiguration_singleton.${key}`, UNIVERSE_AVATAR_REASON),
		);

	return { entryFragment: {}, warnings: [...staticWarnings, ...avatarWarnings] };
}
