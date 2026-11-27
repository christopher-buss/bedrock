import type { HttpRequest } from "../../../internal/http/types.ts";
import type { GetAssetParameters } from "./types.ts";

/**
 * Builds a `GET` request for `Assets_GetAsset` with no `readMask`.
 *
 * @param parameters - The asset to read.
 * @returns The read request.
 */
export function buildGetRequest(parameters: GetAssetParameters): HttpRequest {
	return { method: "GET", url: `/assets/v1/assets/${parameters.assetId}` };
}
