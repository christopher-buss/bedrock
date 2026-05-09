import type { HttpRequest } from "../../../internal/http/types.ts";
import { toBlob } from "../../../internal/utils/to-blob.ts";
import type { UploadBadgeIconLocalizationParameters } from "./types.ts";

/**
 * Builds a `POST` request for the localized "upload badge icon" endpoint. A
 * successful upload replaces any existing icon for the same
 * `(badgeId, languageCode)` pair.
 *
 * @param parameters - Badge and language identifiers plus the image bytes
 *   to upload.
 * @returns A pure {@link HttpRequest} describing the upload call.
 */
export function buildUploadIconRequest(
	parameters: UploadBadgeIconLocalizationParameters,
): HttpRequest {
	const body = new FormData();
	body.append("Files", toBlob(parameters.image));

	return {
		body,
		method: "POST",
		url: `/legacy-game-internationalization/v1/badges/${parameters.badgeId}/icons/language-codes/${parameters.languageCode}`,
	};
}
