import type { HttpRequest } from "../../../internal/http/types.ts";
import { toBlob } from "../../../internal/utils/to-blob.ts";
import type { UploadGamePassIconParameters } from "./types.ts";

/**
 * Builds a `POST` request for the localized "upload game-pass icon"
 * endpoint. A successful upload replaces any existing icon for the same
 * `(gamePassId, languageCode)` pair.
 *
 * @param parameters - Game pass and language identifiers plus the image
 *   bytes to upload.
 * @returns A pure {@link HttpRequest} describing the upload call.
 */
export function buildUploadIconRequest(parameters: UploadGamePassIconParameters): HttpRequest {
	const body = new FormData();
	body.append("Files", toBlob(parameters.image));

	return {
		body,
		method: "POST",
		url: `/legacy-game-internationalization/v1/game-passes/${parameters.gamePassId}/icons/language-codes/${parameters.languageCode}`,
	};
}
