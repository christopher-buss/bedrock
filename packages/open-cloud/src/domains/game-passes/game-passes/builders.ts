import type { HttpRequest } from "../../../internal/http/types.ts";
import { toBlob } from "../../../internal/utils/to-blob.ts";
import type {
	CreateGamePassParameters,
	GetGamePassParameters,
	ListGamePassesParameters,
	UpdateGamePassParameters,
} from "./types.ts";

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
 * Builds a `GET` request for the Open Cloud "list game passes" endpoint.
 * Optional `pageSize` and `pageToken` are appended to the query string only
 * when defined so the server applies its own defaults for omitted fields.
 *
 * @param parameters - Universe identifier plus optional pagination cursors.
 * @returns A pure {@link HttpRequest} describing the list call.
 */
export function buildListRequest(parameters: ListGamePassesParameters): HttpRequest {
	const query = new URLSearchParams();
	if (parameters.pageSize !== undefined) {
		query.append("pageSize", String(parameters.pageSize));
	}

	if (parameters.pageToken !== undefined) {
		query.append("pageToken", parameters.pageToken);
	}

	const queryString = query.toString();
	const base = `/game-passes/v1/universes/${parameters.universeId}/game-passes/creator`;
	return {
		method: "GET",
		url: queryString === "" ? base : `${base}?${queryString}`,
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

/**
 * Builds a `PATCH` request for the Open Cloud "update game pass" endpoint.
 * Every field on `parameters` except the identifiers is optional;
 * omitted fields are not appended to the multipart body so the server
 * leaves their current values unchanged.
 *
 * @param parameters - Identifiers plus fields to update.
 * @returns A pure {@link HttpRequest} describing the update call.
 */
export function buildUpdateRequest(parameters: UpdateGamePassParameters): HttpRequest {
	const body = new FormData();
	if (parameters.name !== undefined) {
		body.append("name", parameters.name);
	}

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
		method: "PATCH",
		url: `/game-passes/v1/universes/${parameters.universeId}/game-passes/${parameters.gamePassId}`,
	};
}
