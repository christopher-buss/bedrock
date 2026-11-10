import type { HttpRequest } from "../../../internal/http/types.ts";
import type { DownloadAssetParameters } from "./types.ts";

/**
 * Builds a `GET` request for the Open Cloud asset delivery endpoint, which
 * answers with a short-lived CDN `location` for the stored content.
 *
 * @param parameters - The asset to resolve.
 * @returns A pure {@link HttpRequest} describing the call.
 */
export function buildLocationRequest(parameters: DownloadAssetParameters): HttpRequest {
	return {
		method: "GET",
		url: `/asset-delivery-api/v1/assetId/${encodeURIComponent(parameters.assetId)}`,
	};
}
