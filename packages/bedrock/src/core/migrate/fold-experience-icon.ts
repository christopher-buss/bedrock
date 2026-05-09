import {
	blockedWarning,
	EMPTY_FRAGMENT,
	type FoldFragment,
	isObjectPayload,
} from "./fold-universe-shared.ts";
import type { MantleResource } from "./types.ts";

const EXPERIENCE_ICON_KIND = "experienceIcon";

const BLOCKED_REASON =
	"Open Cloud has no route to set a universe's source-language game icon; configure it via the Roblox creator portal.";

/**
 * Surface every Mantle `experienceIcon_<key>` resource as a `blocked`
 * migration warning. Bedrock has no `UniverseEntry.icon` field today
 * because no Open Cloud endpoint accepts a source-language game icon, so
 * the migrator emits one warning per legacy resource (rather than the
 * first matching entry only) so the operator can audit each affected
 * environment before reconfiguring the icon by hand.
 *
 * Resources whose payload is malformed (non-object inputs/outputs,
 * non-string `filePath`) are skipped silently, matching the
 * malformed-payload behaviour of the other fold rules.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns A fragment whose `warnings` carries one `blocked` entry per
 *   legacy experience-icon resource, or {@link EMPTY_FRAGMENT} when none
 *   are present.
 */
export function foldExperienceIcon(resources: ReadonlyArray<MantleResource>): FoldFragment {
	const warnings = resources
		.filter(
			(resource) => resource.kind === EXPERIENCE_ICON_KIND && hasReadablePayload(resource),
		)
		.map((resource) =>
			blockedWarning(`${EXPERIENCE_ICON_KIND}_${resource.key}`, BLOCKED_REASON),
		);

	if (warnings.length === 0) {
		return EMPTY_FRAGMENT;
	}

	return { entryFragment: {}, warnings };
}

function hasReadablePayload(resource: MantleResource): boolean {
	if (!isObjectPayload(resource.inputs)) {
		return false;
	}

	const { filePath } = resource.inputs;
	return typeof filePath === "string";
}
