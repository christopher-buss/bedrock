import type { HttpRequest } from "../../internal/http/types.ts";
import type { GetGamePassParameters } from "./types.ts";

/**
 * Builds a `GET` request for the Open Cloud "read game pass" endpoint.
 *
 * @param params - Universe and game pass identifiers to interpolate into the
 *   URL.
 * @returns A pure {@link HttpRequest} describing the read call.
 */
export function buildGetRequest(params: GetGamePassParameters): HttpRequest {
	return {
		method: "GET",
		url: `/game-passes/v1/universes/${params.universeId}/game-passes/${params.gamePassId}/creator`,
	};
}
