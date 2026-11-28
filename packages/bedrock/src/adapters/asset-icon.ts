import { OpenCloudError, type RequestOptions, type Result } from "@bedrock-rbx/ocale";
import type {
	AssetCreator,
	AssetsClient,
	CreateImageParameters,
	ImageContentType,
} from "@bedrock-rbx/ocale/assets";
import type { UniverseOwner } from "@bedrock-rbx/ocale/universes";

import { sha256HexAsync } from "../core/kinds/hash.ts";
import { isRedactedIconPath } from "../core/redacted-icon.ts";
import { asRobloxAssetId, type RobloxAssetId, type Sha256Hex } from "../types/ids.ts";

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
	/**
	 * Hash of the declared icon file when no image is recorded. A live icon
	 * whose bytes have this hash is kept without an upload.
	 */
	readonly liveMatchHash: Sha256Hex | undefined;
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
 * How a driver reconciles the icon it manages on a place asset.
 *
 * @template TDeps - The icon clients the driver was built with.
 * @template TOutputs - The icon outputs the driver records.
 */
export interface AssetIconReconcile<TDeps, TOutputs> {
	/** The driver's icon clients, absent when it was built without them. */
	readonly deps: TDeps | undefined;
	/** Whether the icon needs a write. */
	readonly isChanged: boolean;
	/** The error message when the icon needs a write and `deps` is absent. */
	readonly missingDeps: string;
	/** The outputs to keep when the icon needs no write. */
	readonly recorded: TOutputs;
	/** Set or remove the icon with the driver's clients. */
	readonly set: (deps: TDeps) => Promise<Result<RobloxAssetId | undefined, OpenCloudError>>;
	/**
	 * The outputs to record for the image now set, `undefined` once removed.
	 */
	readonly toOutputs: (iconAssetId: RobloxAssetId | undefined) => TOutputs;
}

/**
 * What reading a place's live icon found: the image set on it, `undefined`
 * for a place without an icon, or nothing at all when the icon was not read.
 */
type LiveIconRead =
	| { readonly iconAssetId: RobloxAssetId | undefined; readonly kind: "read" }
	| { readonly kind: "unread" };

/** The `iconAssetIds` live output of a place or universe. */
interface LiveIconOutputs {
	/** The live icon, `undefined` for none; absent when it was not read. */
	readonly iconAssetIds?: Record<"en-us", RobloxAssetId> | undefined;
}

/**
 * Keep the recorded icon outputs when the icon needs no write; otherwise set
 * or remove the icon and record the outputs for the result.
 *
 * @template TDeps - The icon clients the driver was built with.
 * @template TOutputs - The icon outputs the driver records.
 * @param reconcile - The driver's icon clients, change check, and outputs.
 * @returns The icon outputs to record, or why the icon could not be written.
 */
export async function reconcileAssetIconAsync<TDeps, TOutputs>({
	deps,
	isChanged,
	missingDeps,
	recorded,
	set,
	toOutputs,
}: AssetIconReconcile<TDeps, TOutputs>): Promise<Result<TOutputs, OpenCloudError>> {
	if (!isChanged) {
		return { data: recorded, success: true };
	}

	if (deps === undefined) {
		return { err: new OpenCloudError(missingDeps), success: false };
	}

	const iconAssetId = await set(deps);
	return iconAssetId.success ? { data: toOutputs(iconAssetId.data), success: true } : iconAssetId;
}

/**
 * Image inputs for a place asset's icon from the image its state records.
 * A recorded image is set again unless the file changed; with no recorded
 * image, a live icon that matches the declared file is kept.
 *
 * @param recorded - Image IDs the state records, if any.
 * @param declared - Declared file hashes, and whether the file changed.
 * @returns The `imageId` and `liveMatchHash` inputs.
 */
export function recordedImageInputs(
	recorded: Record<"en-us", RobloxAssetId> | undefined,
	{
		hashes,
		isImageChanged,
	}: {
		readonly hashes: Record<"en-us", Sha256Hex> | undefined;
		readonly isImageChanged: boolean;
	},
): Pick<AssetIconInputs, "imageId" | "liveMatchHash"> {
	return {
		imageId: isImageChanged ? undefined : recorded?.["en-us"],
		liveMatchHash: recorded === undefined ? hashes?.["en-us"] : undefined,
	};
}

/**
 * Read the live icon of a place as the live state records it.
 *
 * @param assets - Assets client; the icon is unread without one.
 * @param placeId - Place whose icon to read, if known.
 * @returns The live icon outputs for the place or universe.
 */
export async function readLiveIconOutputsAsync(
	assets: AssetsClient | undefined,
	placeId: string | undefined,
): Promise<LiveIconOutputs> {
	return liveIconOutputs(await readLiveIconAsync(assets, placeId));
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
	const live = await matchingLiveIconAsync(deps.assets, inputs);
	if (live !== undefined) {
		return { data: asRobloxAssetId(live), success: true };
	}

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

/**
 * Read the live source-language icon of a place. An icon the credential
 * cannot read is `unread`, so the live check skips it.
 *
 * @param assets - Assets client; the icon is unread without one.
 * @param placeId - Place whose icon to read, if known.
 * @returns The live icon, or `unread` when it could not be read.
 */
async function readLiveIconAsync(
	assets: AssetsClient | undefined,
	placeId: string | undefined,
): Promise<LiveIconRead> {
	if (placeId === undefined || assets === undefined) {
		return { kind: "unread" };
	}

	const icon = await assets.getIcon({ assetId: placeId });
	if (!icon.success) {
		return { kind: "unread" };
	}

	return {
		iconAssetId: icon.data === undefined ? undefined : asRobloxAssetId(icon.data),
		kind: "read",
	};
}

/**
 * The live icon outputs of a place or universe. The live check compares
 * `iconAssetIds` only when it is present: `undefined` is a readable place
 * without an icon, and an absent key an icon that was not read.
 *
 * @param read - What reading the live icon found.
 * @returns The `iconAssetIds` output for the live state.
 */
function liveIconOutputs(read: LiveIconRead): LiveIconOutputs {
	if (read.kind === "unread") {
		return {};
	}

	return {
		iconAssetIds: read.iconAssetId === undefined ? undefined : { "en-us": read.iconAssetId },
	};
}

/**
 * Find the live icon of the place when its bytes match the declared file.
 * A failed read or download finds nothing, so the caller uploads.
 *
 * @param assets - Assets client that reads and downloads the live icon.
 * @param inputs - Declared icon, recorded image, and the declared file's hash.
 * @returns The live image asset ID, or `undefined` when it must be uploaded.
 */
async function matchingLiveIconAsync(
	assets: AssetsClient,
	{ liveMatchHash, options, placeId }: AssetIconInputs,
): Promise<string | undefined> {
	if (liveMatchHash === undefined) {
		return undefined;
	}

	const live = await assets.getIcon({ assetId: placeId }, options);
	if (!live.success || live.data === undefined) {
		return undefined;
	}

	const bytes = await assets.download({ assetId: live.data }, options);
	if (!bytes.success) {
		return undefined;
	}

	return (await sha256HexAsync(bytes.data)) === liveMatchHash ? live.data : undefined;
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
	const contentType = isRedactedIconPath(path)
		? "image/png"
		: CONTENT_TYPES.get(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
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
	if (icon === undefined) {
		return { data: undefined, success: true };
	}

	if (imageId !== undefined) {
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
