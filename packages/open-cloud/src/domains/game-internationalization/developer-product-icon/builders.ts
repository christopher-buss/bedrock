import type { HttpRequest } from "../../../client/types.ts";
import { toBlob } from "../../../internal/utils/to-blob.ts";
import type { UploadDeveloperProductIconParameters } from "./types.ts";

/**
 * Builds a `POST` request for the localized "upload developer-product icon"
 * endpoint. A successful upload replaces any existing icon for the same
 * `(productId, languageCode)` pair.
 *
 * @param parameters - Product and language identifiers plus the image bytes
 *   to upload.
 * @returns A pure {@link HttpRequest} describing the upload call.
 */
export function buildUploadIconRequest(
	parameters: UploadDeveloperProductIconParameters,
): HttpRequest {
	const body = new FormData();
	body.append("Files", toBlob(parameters.image));

	return {
		body,
		method: "POST",
		url: `/legacy-game-internationalization/v1/developer-products/${parameters.productId}/icons/language-codes/${parameters.languageCode}`,
	};
}
