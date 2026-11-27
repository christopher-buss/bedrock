import type { HttpRequest } from "../../../internal/http/types.ts";
import type {
	CreateImageParameters,
	GetAssetOperationParameters,
	GetAssetParameters,
	ImageContentType,
} from "./types.ts";

const FILE_NAMES: Readonly<Record<ImageContentType, string>> = Object.freeze({
	"image/bmp": "image.bmp",
	"image/jpeg": "image.jpg",
	"image/png": "image.png",
	"image/tga": "image.tga",
});

/**
 * Builds a `GET` request for `Assets_GetAsset` with no `readMask`.
 *
 * @param parameters - The asset to read.
 * @returns The read request.
 */
export function buildGetRequest(parameters: GetAssetParameters): HttpRequest {
	return { method: "GET", url: `/assets/v1/assets/${parameters.assetId}` };
}

/**
 * Builds a `GET` request for `Assets_GetAsset` with `readMask=icon`. A plain
 * read never returns `icon`.
 *
 * @param parameters - The asset whose icon to read.
 * @returns The read request.
 */
export function buildGetIconRequest(parameters: GetAssetParameters): HttpRequest {
	return { method: "GET", url: `/assets/v1/assets/${parameters.assetId}?readMask=icon` };
}

/**
 * Builds the multipart `POST` for `Assets_CreateAsset` that creates an
 * `OpenUse` image: a JSON `request` part and the `fileContent` part.
 *
 * @param parameters - The image file, its content type and its owner.
 * @returns The `POST` request with its multipart body.
 */
export function buildCreateImageRequest(parameters: CreateImageParameters): HttpRequest {
	const body = new FormData();
	body.append(
		"request",
		JSON.stringify({
			assetType: "Image",
			creationContext: { assetPrivacy: "OpenUse", creator: parameters.creator },
			description: parameters.description ?? "",
			displayName: parameters.displayName,
		}),
	);
	body.append(
		"fileContent",
		new Blob([new Uint8Array(parameters.fileContent)], { type: parameters.contentType }),
		FILE_NAMES[parameters.contentType],
	);
	return { body, method: "POST", url: "/assets/v1/assets" };
}

/**
 * Builds a `GET` request for `Assets_GetOperation`.
 *
 * @param parameters - The operation to read.
 * @returns The read request.
 */
export function buildGetOperationRequest(parameters: GetAssetOperationParameters): HttpRequest {
	return { method: "GET", url: `/assets/v1/operations/${parameters.operationId}` };
}
