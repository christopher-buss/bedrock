// The Roblox `gameinternationalization` paths use a `{gameId}` URL segment
// that is in fact the universe ID. The package surfaces only `universeId` and
// these builders perform the substitution at the wire boundary.

import { ValidationError } from "../../errors/validation.ts";
import type { HttpRequest } from "../../internal/http/types.ts";
import type { Result } from "../../types.ts";
import type {
	DeleteExperienceThumbnailParameters,
	ReorderExperienceThumbnailsParameters,
	UploadExperienceThumbnailParameters,
} from "./types.ts";

/**
 * Builds a `POST` request for the localized "upload experience thumbnail"
 * endpoint. Each successful upload appends a new entry to the carousel.
 *
 * @param parameters - Universe and language identifiers plus the image
 *   bytes to upload.
 * @returns A pure {@link HttpRequest} describing the upload call.
 */
export function buildUploadThumbnailRequest(
	parameters: UploadExperienceThumbnailParameters,
): HttpRequest {
	const body = new FormData();
	body.append("gameThumbnailRequest.files", toBlob(parameters.image));

	return {
		body,
		method: "POST",
		url: `/legacy-game-internationalization/v1/game-thumbnails/games/${parameters.universeId}/language-codes/${parameters.languageCode}/image`,
	};
}

/**
 * Builds a `DELETE` request for the "delete experience thumbnail" endpoint.
 *
 * @param parameters - Universe, language, and image identifiers of the
 *   thumbnail to delete.
 * @returns A pure {@link HttpRequest} describing the delete call.
 */
export function buildDeleteThumbnailRequest(
	parameters: DeleteExperienceThumbnailParameters,
): HttpRequest {
	return {
		method: "DELETE",
		url: `/legacy-game-internationalization/v1/game-thumbnails/games/${parameters.universeId}/language-codes/${parameters.languageCode}/images/${parameters.imageId}`,
	};
}

/**
 * Builds a `POST` request for the "reorder experience thumbnails" endpoint.
 * Validates each supplied image ID at the wire boundary so a typo cannot
 * silently serialize as JSON `null` and corrupt the request.
 *
 * @param parameters - Universe, language, and the desired display order.
 * @returns A success result wrapping the request, or a
 *   {@link ValidationError} when `orderedImageIds` is empty or any ID is not
 *   a positive integer within the safe-integer range.
 */
export function buildReorderThumbnailsRequest(
	parameters: ReorderExperienceThumbnailsParameters,
): Result<HttpRequest, ValidationError> {
	const { languageCode, orderedImageIds, universeId } = parameters;

	const idsResult = parseOrderedImageIds(orderedImageIds);
	if (!idsResult.success) {
		return idsResult;
	}

	return {
		data: {
			body: { mediaAssetIds: idsResult.data },
			method: "POST",
			url: `/legacy-game-internationalization/v1/game-thumbnails/games/${universeId}/language-codes/${languageCode}/images/order`,
		},
		success: true,
	};
}

function toBlob(value: Blob | Uint8Array): Blob {
	if (value instanceof Blob) {
		return value;
	}

	return new Blob([new Uint8Array(value)]);
}

function parseImageId(value: string): number | undefined {
	if (!/^[1-9]\d*$/.test(value)) {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		return undefined;
	}

	return parsed;
}

function parseOrderedImageIds(
	orderedImageIds: ReadonlyArray<string>,
): Result<ReadonlyArray<number>, ValidationError> {
	if (orderedImageIds.length === 0) {
		return {
			err: new ValidationError("orderedImageIds must contain at least one image ID", {
				code: "empty_image_ids",
			}),
			success: false,
		};
	}

	const mediaAssetIds: Array<number> = [];
	for (const id of orderedImageIds) {
		const parsed = parseImageId(id);
		if (parsed === undefined) {
			return {
				err: new ValidationError(
					`orderedImageIds entry ${JSON.stringify(id)} is not a positive integer ID`,
					{ code: "invalid_image_id" },
				),
				success: false,
			};
		}

		mediaAssetIds.push(parsed);
	}

	return { data: mediaAssetIds, success: true };
}
