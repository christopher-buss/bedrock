// The legacy `{gameId}` URL segment is in fact the universe ID; the public API
// takes `universeId` and substitutes it into the path.

import type { HttpRequest } from "../../../internal/http/types.ts";
import { toBlob } from "../../../internal/utils/to-blob.ts";
import type {
	DeleteExperienceIconParameters,
	ListExperienceIconsParameters,
	UploadExperienceIconParameters,
} from "./types.ts";

/**
 * Builds a `POST` request for the localized "upload experience icon"
 * endpoint. A successful upload replaces any existing icon for the same
 * `(universeId, languageCode)` pair.
 *
 * @param parameters - Universe and language identifiers plus the image
 *   bytes to upload.
 * @returns A pure {@link HttpRequest} describing the upload call.
 */
export function buildUploadIconRequest(parameters: UploadExperienceIconParameters): HttpRequest {
	const body = new FormData();
	// The legacy game-icon endpoint reads the upload from `request.files`.
	body.append("request.files", toBlob(parameters.image));

	return {
		body,
		method: "POST",
		url: `/legacy-game-internationalization/v1/game-icon/games/${parameters.universeId}/language-codes/${parameters.languageCode}`,
	};
}

/**
 * Builds a `DELETE` request for the localized "delete experience icon"
 * endpoint. Removing the source-language icon is rejected server-side;
 * deleting the icon for a non-source language clears that translation.
 *
 * @param parameters - Universe and language identifiers of the icon to
 *   delete.
 * @returns A pure {@link HttpRequest} describing the delete call.
 */
export function buildDeleteIconRequest(parameters: DeleteExperienceIconParameters): HttpRequest {
	return {
		method: "DELETE",
		url: `/legacy-game-internationalization/v1/game-icon/games/${parameters.universeId}/language-codes/${parameters.languageCode}`,
	};
}

/**
 * Builds a `GET` request for the "list experience icons" endpoint. The
 * server returns one entry per locale that has an icon registered.
 *
 * @param parameters - Universe identifier whose icons to list.
 * @returns A pure {@link HttpRequest} describing the list call.
 */
export function buildListIconsRequest(parameters: ListExperienceIconsParameters): HttpRequest {
	return {
		method: "GET",
		url: `/legacy-game-internationalization/v1/game-icon/games/${parameters.universeId}`,
	};
}
