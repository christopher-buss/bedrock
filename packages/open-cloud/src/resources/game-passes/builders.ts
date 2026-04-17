import type { HttpRequest } from "../../internal/http/types.ts";
import type { CreateGamePassParameters, GetGamePassParameters } from "./types.ts";

/**
 * Builds a `GET` request for the Open Cloud "read game pass" endpoint.
 *
 * @param parameters - Universe and game pass identifiers to interpolate into
 *   the URL.
 * @returns A pure {@link HttpRequest} describing the read call.
 */
export function buildGetRequest(parameters: GetGamePassParameters): HttpRequest {
	return {
		method: "GET",
		url: `/game-passes/v1/universes/${parameters.universeId}/game-passes/${parameters.gamePassId}/creator`,
	};
}

/**
 * Builds a `POST` request for the Open Cloud "create game pass" endpoint.
 *
 * @param parameters - Fields describing the new game pass; optional values
 *   omitted here are left off the multipart payload entirely.
 * @returns A pure {@link HttpRequest} describing the create call.
 */
export function buildCreateRequest(parameters: CreateGamePassParameters): HttpRequest {
	const body = new FormData();
	body.append("name", parameters.name);
	if (parameters.description !== undefined) {
		body.append("description", parameters.description);
	}

	if (parameters.isForSale !== undefined) {
		body.append("isForSale", String(parameters.isForSale));
	}

	if (parameters.price !== undefined) {
		body.append("price", String(parameters.price));
	}

	if (parameters.isRegionalPricingEnabled !== undefined) {
		body.append("isRegionalPricingEnabled", String(parameters.isRegionalPricingEnabled));
	}

	if (parameters.imageFile !== undefined) {
		body.append("imageFile", toBlob(parameters.imageFile));
	}

	return {
		body,
		method: "POST",
		url: `/game-passes/v1/universes/${parameters.universeId}/game-passes`,
	};
}

function toBlob(value: Blob | Uint8Array): Blob {
	if (value instanceof Blob) {
		return value;
	}

	return new Blob([new Uint8Array(value)]);
}
