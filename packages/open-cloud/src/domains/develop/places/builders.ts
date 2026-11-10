import type { HttpRequest } from "../../../internal/http/types.ts";
import type { ListPlacesParameters } from "./types.ts";

/**
 * Builds the `GET` request listing one page of a universe's places. Maps
 * `pageSize` to `limit` and `pageToken` to `cursor`, each only when defined.
 *
 * @param parameters - Universe ID plus optional pagination fields.
 * @returns A pure {@link HttpRequest} describing the list call.
 */
export function buildListPlacesRequest(parameters: ListPlacesParameters): HttpRequest {
	const query = new URLSearchParams();
	if (parameters.pageSize !== undefined) {
		query.append("limit", String(parameters.pageSize));
	}

	if (parameters.pageToken !== undefined) {
		query.append("cursor", parameters.pageToken);
	}

	const queryString = query.toString();
	const base = `/v1/universes/${parameters.universeId}/places`;
	return { method: "GET", url: queryString === "" ? base : `${base}?${queryString}` };
}
