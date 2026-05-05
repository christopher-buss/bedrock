import { asRobloxAssetId } from "../../types/ids.ts";
import {
	EMPTY_FRAGMENT,
	type FoldFragment,
	interpretiveWarning,
	isObjectPayload,
} from "./fold-universe-shared.ts";
import type { MantleResource } from "./types.ts";

const EXPERIENCE_ICON_KIND = "experienceIcon";

interface ExperienceIconParts {
	readonly assetId: string;
	readonly filePath: string;
}

/**
 * Fold the Mantle `experienceIcon_<key>` resource into the universe's
 * locale-keyed `icon` map and the `iconAssetIds` slot of its outputs.
 * Mantle has no locale concept on `experienceIcon`; the fold assigns the
 * single image to `"en-us"` and emits one `interpretive` warning so the
 * migration report records the implicit locale assignment.
 *
 * Resources whose payload is malformed (non-object inputs/outputs,
 * non-string `filePath`, missing or non-coercible `assetId`) drop
 * silently. The first matching resource wins; ambiguity handling for
 * multiple `experienceIcon` resources lands in a follow-up slice.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns The folded icon entry plus per-rule diagnostics.
 */
export function foldExperienceIcon(resources: ReadonlyArray<MantleResource>): FoldFragment {
	const [first] = resources.filter((resource) => resource.kind === EXPERIENCE_ICON_KIND);
	if (first === undefined) {
		return EMPTY_FRAGMENT;
	}

	const parts = readParts(first);
	if (parts === undefined) {
		return EMPTY_FRAGMENT;
	}

	return {
		entryFragment: { icon: { "en-us": parts.filePath } },
		outputsFragment: {
			iconAssetIds: { "en-us": asRobloxAssetId(parts.assetId) },
		},
		warnings: [
			interpretiveWarning({
				bedrockPath: "universe.icon",
				mantlePath: `${EXPERIENCE_ICON_KIND}_${first.key}`,
				rule: "experience-icon-to-en-us-locale",
			}),
		],
	};
}

function coerceRobloxId(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}

	if (Number.isInteger(value)) {
		return String(value);
	}

	return undefined;
}

function readParts(resource: MantleResource): ExperienceIconParts | undefined {
	if (!isObjectPayload(resource.inputs)) {
		return undefined;
	}

	const { filePath } = resource.inputs;
	if (typeof filePath !== "string") {
		return undefined;
	}

	if (!isObjectPayload(resource.outputs)) {
		return undefined;
	}

	const assetId = coerceRobloxId(resource.outputs["assetId"]);
	if (assetId === undefined) {
		return undefined;
	}

	return { assetId, filePath };
}
