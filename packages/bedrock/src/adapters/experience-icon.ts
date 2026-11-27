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
	/** Declared locale-keyed icon paths; `undefined` removes the icon. */
	readonly icon: Record<"en-us", string> | undefined;
	/** Request options forwarded to every Assets call. */
	readonly options: RequestOptions | undefined;
	/** Universe owner; the uploaded image is created as them. */
	readonly owner: UniverseOwner;
	/** Live start place that receives the icon. */
	readonly startPlaceId: string;
}

/**
 * Upload the declared experience icon as the universe owner and set it on the
 * live start place, or remove the icon from it when none is declared.
 *
 * @param deps - Assets client and file reader.
 * @param inputs - Declared icon, universe owner, and live start place.
 * @returns The icon outputs to record, or the failed Open Cloud call.
 */
export async function setExperienceIconAsync(
	deps: ExperienceIconDeps,
	inputs: ExperienceIconInputs,
): Promise<Result<ExperienceIconOutputs, OpenCloudError>> {
	const image = await uploadImageAsync(deps, inputs);
	if (!image.success) {
		return image;
	}

	const { options, startPlaceId } = inputs;
	const updated = await deps.assets.updateIcon(
		{ assetId: startPlaceId, iconAssetId: image.data },
		options,
	);
	if (!updated.success) {
		return updated;
	}

	return {
		data:
			image.data === undefined
				? {}
				: {
						iconAssetIds: { "en-us": asRobloxAssetId(image.data) },
						iconStartPlaceId: asRobloxAssetId(startPlaceId),
					},
		success: true,
	};
}

function creatorOf(owner: UniverseOwner): AssetCreator {
	return owner.kind === "group" ? { groupId: owner.id } : { userId: owner.id };
}

async function uploadImageAsync(
	deps: ExperienceIconDeps,
	{ icon, options, owner }: ExperienceIconInputs,
): Promise<Result<string | undefined, OpenCloudError>> {
	if (icon === undefined) {
		return { data: undefined, success: true };
	}

	const uploaded = await deps.assets.createImage(
		{
			contentType: "image/png",
			creator: creatorOf(owner),
			displayName: "Experience icon",
			fileContent: await deps.readFile(icon["en-us"]),
		},
		options,
	);
	return uploaded.success ? { data: uploaded.data.assetId, success: true } : uploaded;
}
