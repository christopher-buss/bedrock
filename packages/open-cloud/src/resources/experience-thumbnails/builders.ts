import { ValidationError } from "../../errors/validation.ts";
import type { HttpRequest } from "../../internal/http/types.ts";
import { toBlob } from "../../internal/utils/to-blob.ts";
import type { Result } from "../../types.ts";
import type {
	DeleteExperienceThumbnailParameters,
	ReorderExperienceThumbnailsParameters,
	UploadExperienceThumbnailParameters,
} from "./types.ts";

type ParsedIdsResult = Result<ReadonlyArray<number>, ValidationError>;

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
	// The legacy game-thumbnails endpoint reads the upload from
	// `gameThumbnailRequest.files`, distinct from game-icon's `request.files`.
	body.append("gameThumbnailRequest.files", toBlob(parameters.image));

	return {
		body,
		method: "POST",
		// The `{gameId}` URL segment in this legacy path is in fact the
		// universe ID; the package surfaces only `universeId`.
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

function appendParsedId(accumulator: ParsedIdsResult, id: string): ParsedIdsResult {
	if (!accumulator.success) {
		return accumulator;
	}

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

	return { data: [...accumulator.data, parsed], success: true };
}

function parseOrderedImageIds(orderedImageIds: ReadonlyArray<string>): ParsedIdsResult {
	if (orderedImageIds.length === 0) {
		return {
			err: new ValidationError("orderedImageIds must contain at least one image ID", {
				code: "empty_image_ids",
			}),
			success: false,
		};
	}

	return orderedImageIds.reduce<ParsedIdsResult>(appendParsedId, { data: [], success: true });
}
