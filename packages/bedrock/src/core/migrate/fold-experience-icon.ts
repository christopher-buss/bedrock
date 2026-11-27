import { asRobloxAssetId, asSha256Hex, isSha256Hex, type Sha256Hex } from "../../types/ids.ts";
import {
	coerceRobloxId,
	EMPTY_FRAGMENT,
	type FoldFragment,
	isObjectPayload,
} from "./fold-universe-shared.ts";
import type { MantleResource } from "./types.ts";

const EXPERIENCE_ICON_KIND = "experienceIcon";

/**
 * Experience icon as Mantle recorded it: the declared path plus the file
 * hash, which stands in when the icon file cannot be read from disk.
 */
export interface MantleExperienceIcon {
	/** Locale-keyed icon path, as written to `universe.icon`. */
	readonly icon: Record<"en-us", string>;
	/** Mantle-recorded icon file hash. */
	readonly iconFileHashes: Record<"en-us", Sha256Hex>;
}

/** Fold result for the experience icon. */
export interface ExperienceIconFold extends FoldFragment {
	/** The folded icon; absent when no icon folded. */
	readonly mantleIcon?: MantleExperienceIcon;
}

interface ExperienceIconPayload {
	readonly assetId: string;
	readonly fileHash: Sha256Hex;
	readonly filePath: string;
}

/**
 * Fold Mantle's `experienceIcon` resource into `universe.icon`
 * and the universe outputs that record the uploaded image and the start
 * place that received it.
 *
 * Resources whose payload is malformed (non-object inputs or outputs, a
 * non-string `filePath`, an invalid `fileHash`, a missing `assetId`) are
 * skipped silently, matching the malformed-payload behaviour of the other
 * fold rules.
 *
 * @param resources - Mantle resource list for one environment.
 * @param startPlaceId - The Mantle experience's start place.
 * @returns The icon fragment, or {@link EMPTY_FRAGMENT} when no icon folds.
 */
export function foldExperienceIcon(
	resources: ReadonlyArray<MantleResource>,
	startPlaceId: string,
): ExperienceIconFold {
	const resource = resources.find(({ kind }) => kind === EXPERIENCE_ICON_KIND);
	const payload = resource === undefined ? undefined : readPayload(resource);
	if (payload === undefined) {
		return EMPTY_FRAGMENT;
	}

	const icon = { "en-us": payload.filePath };
	return {
		entryFragment: { icon },
		mantleIcon: { icon, iconFileHashes: { "en-us": payload.fileHash } },
		outputsFragment: {
			iconAssetIds: { "en-us": asRobloxAssetId(payload.assetId) },
			iconStartPlaceId: asRobloxAssetId(startPlaceId),
		},
		warnings: [],
	};
}

function readPayload({ inputs, outputs }: MantleResource): ExperienceIconPayload | undefined {
	if (!isObjectPayload(inputs) || !isObjectPayload(outputs)) {
		return undefined;
	}

	const { fileHash, filePath } = inputs;
	const assetId = coerceRobloxId(outputs["assetId"]);
	if (
		assetId === undefined ||
		typeof filePath !== "string" ||
		typeof fileHash !== "string" ||
		!isSha256Hex(fileHash)
	) {
		return undefined;
	}

	return { assetId, fileHash: asSha256Hex(fileHash), filePath };
}
