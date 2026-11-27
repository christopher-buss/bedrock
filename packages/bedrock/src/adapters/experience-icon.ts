import type { OpenCloudError, RequestOptions, Result } from "@bedrock-rbx/ocale";
import type { AssetCreator, AssetsClient } from "@bedrock-rbx/ocale/assets";
import type { UniverseOwner } from "@bedrock-rbx/ocale/universes";

import type { UniverseOutputs } from "../core/resources.ts";
import { asRobloxAssetId } from "../types/ids.ts";

/** Icon fields of the universe outputs. */
export type ExperienceIconOutputs = Pick<UniverseOutputs, "iconAssetIds" | "iconStartPlaceId">;

/** I/O the universe driver needs to set the experience icon. */
export interface ExperienceIconDeps {
	/** Assets client that uploads the image and sets the icon. */
	readonly assets: AssetsClient;
	/** Reads the icon file bytes for upload. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
}

/** Live facts and declared icon the experience icon is reconciled from. */
export interface ExperienceIconInputs {
	/** Declared locale-keyed icon paths. */
	readonly icon: Record<"en-us", string>;
	/** Request options forwarded to every Assets call. */
	readonly options: RequestOptions | undefined;
	/** Universe owner; the uploaded image is created as them. */
	readonly owner: UniverseOwner;
	/** Live start place that receives the icon. */
	readonly startPlaceId: string;
}

/**
 * Upload the declared experience icon as the universe owner and set it on the
 * live start place.
 *
 * @param deps - Assets client and file reader.
 * @param inputs - Declared icon, universe owner, and live start place.
 * @returns The icon outputs to record, or the failed Open Cloud call.
 */
export async function setExperienceIconAsync(
	deps: ExperienceIconDeps,
	{ icon, options, owner, startPlaceId }: ExperienceIconInputs,
): Promise<Result<ExperienceIconOutputs, OpenCloudError>> {
	const uploaded = await deps.assets.createImage(
		{
			contentType: "image/png",
			creator: creatorOf(owner),
			displayName: "Experience icon",
			fileContent: await deps.readFile(icon["en-us"]),
		},
		options,
	);
	if (!uploaded.success) {
		return uploaded;
	}

	const { assetId } = uploaded.data;
	const updated = await deps.assets.updateIcon(
		{ assetId: startPlaceId, iconAssetId: assetId },
		options,
	);
	if (!updated.success) {
		return updated;
	}

	return {
		data: {
			iconAssetIds: { "en-us": asRobloxAssetId(assetId) },
			iconStartPlaceId: asRobloxAssetId(startPlaceId),
		},
		success: true,
	};
}

function creatorOf(owner: UniverseOwner): AssetCreator {
	return owner.kind === "group" ? { groupId: owner.id } : { userId: owner.id };
}
