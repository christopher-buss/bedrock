import { OpenCloudError, type RequestOptions, type Result } from "@bedrock-rbx/ocale";
import type {
	AssetCreator,
	AssetsClient,
	CreateImageParameters,
	ImageContentType,
} from "@bedrock-rbx/ocale/assets";
import type { UniverseOwner } from "@bedrock-rbx/ocale/universes";

import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";

/** I/O a driver needs to set the icon of a place asset. */
export interface AssetIconDeps {
	/** Assets client that uploads the image and sets the icon. */
	readonly assets: AssetsClient;
	/** Reads the icon file bytes for upload. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
}

/** Declared icon and live facts a place asset's icon is reconciled from. */
export interface AssetIconInputs {
	/** Declared locale-keyed icon paths; `undefined` removes the icon. */
	readonly icon: Record<"en-us", string> | undefined;
	/** Image already uploaded for `icon`; set without a new upload. */
	readonly imageId: string | undefined;
	/** Name of the icon in the uploaded image and in error messages. */
	readonly label: "Experience icon" | "Place icon";
	/** Called with an uploaded image that moderation is still reviewing. */
	readonly onPendingModeration: ((iconAssetId: RobloxAssetId) => void) | undefined;
	/** Request options forwarded to every Assets call. */
	readonly options: RequestOptions | undefined;
	/** Reads the universe owner, who the uploaded image is created as. */
	readonly owner: () =>
		| Promise<Result<UniverseOwner, OpenCloudError>>
		| Result<UniverseOwner, OpenCloudError>;
	/** Place that receives the icon. */
	readonly placeId: string;
}

/**
 * Upload the declared icon as the universe owner and set it on the place, or
 * remove the icon from the place when none is declared.
 *
 * @param deps - Assets client and file reader.
 * @param inputs - Declared icon, universe owner, and target place.
 * @returns The image asset ID now set on the place (`undefined` once
 *   removed), or the failed Open Cloud call.
 */
export async function setAssetIconAsync(
	deps: AssetIconDeps,
	inputs: AssetIconInputs,
): Promise<Result<RobloxAssetId | undefined, OpenCloudError>> {
	const image = await uploadImageAsync(deps, inputs);
	if (!image.success) {
		return image;
	}

	const { options, placeId } = inputs;
	const updated = await deps.assets.updateIcon(
		{ assetId: placeId, iconAssetId: image.data },
		options,
	);
	if (!updated.success) {
		return updated;
	}

	return {
		data: image.data === undefined ? undefined : asRobloxAssetId(image.data),
		success: true,
	};
}

const CONTENT_TYPES: ReadonlyMap<string, ImageContentType> = new Map([
	["bmp", "image/bmp"],
	["jpeg", "image/jpeg"],
	["jpg", "image/jpeg"],
	["png", "image/png"],
	["tga", "image/tga"],
]);

function contentTypeOf(
	path: string,
	label: AssetIconInputs["label"],
): Result<ImageContentType, OpenCloudError> {
	const contentType = CONTENT_TYPES.get(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
	return contentType === undefined
		? {
				err: new OpenCloudError(
					`${label} '${path}' must be a .png, .jpg, .jpeg, .bmp or .tga file`,
				),
				success: false,
			}
		: { data: contentType, success: true };
}

function creatorOf(owner: UniverseOwner): AssetCreator {
	return owner.kind === "group" ? { groupId: owner.id } : { userId: owner.id };
}

async function imageParametersAsync(
	deps: AssetIconDeps,
	{ label, owner, path }: Pick<AssetIconInputs, "label" | "owner"> & { readonly path: string },
): Promise<Result<CreateImageParameters, OpenCloudError>> {
	const contentType = contentTypeOf(path, label);
	if (!contentType.success) {
		return contentType;
	}

	const creator = await owner();
	if (!creator.success) {
		return creator;
	}

	return {
		data: {
			contentType: contentType.data,
			creator: creatorOf(creator.data),
			displayName: label,
			fileContent: await deps.readFile(path),
		},
		success: true,
	};
}

async function uploadImageAsync(
	deps: AssetIconDeps,
	inputs: AssetIconInputs,
): Promise<Result<string | undefined, OpenCloudError>> {
	const { icon, imageId, onPendingModeration, options } = inputs;
	if (icon === undefined || imageId !== undefined) {
		return { data: imageId, success: true };
	}

	const parameters = await imageParametersAsync(deps, { ...inputs, path: icon["en-us"] });
	if (!parameters.success) {
		return parameters;
	}

	const uploaded = await deps.assets.createImage(parameters.data, options);
	if (!uploaded.success) {
		return uploaded;
	}

	const { assetId, moderationState } = uploaded.data;
	if (moderationState === "Reviewing") {
		onPendingModeration?.(asRobloxAssetId(assetId));
	}

	return { data: assetId, success: true };
}
