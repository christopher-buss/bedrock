import type { HttpRequest } from "../../../internal/http/types.ts";
import { toBlob } from "../../../internal/utils/to-blob.ts";
import type { UploadBadgeIconParameters } from "./types.ts";

/**
 * Builds a `POST` request for the legacy "upload badge icon" endpoint. A
 * successful upload replaces any existing source-language icon on the
 * badge.
 *
 * @param parameters - Badge identifier plus the image bytes to upload.
 * @returns A pure {@link HttpRequest} describing the upload call.
 */
export function buildUploadIconRequest(parameters: UploadBadgeIconParameters): HttpRequest {
	const body = new FormData();
	body.append("Files", toBlob(parameters.icon));

	return {
		body,
		method: "POST",
		url: `/legacy-publish/v1/badges/${parameters.badgeId}/icon`,
	};
}
