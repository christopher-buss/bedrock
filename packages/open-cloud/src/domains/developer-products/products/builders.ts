import type { HttpRequest } from "../../../internal/http/types.ts";
import { toBlob } from "../../../internal/utils/to-blob.ts";
import type {
	CreateDeveloperProductParameters,
	GetDeveloperProductParameters,
	UpdateDeveloperProductParameters,
} from "./types.ts";

/**
 * Builds a `GET` request for the Open Cloud "read developer product"
 * endpoint.
 *
 * @param parameters - Universe and product identifiers to interpolate into
 *   the URL.
 * @returns A pure {@link HttpRequest} describing the read call.
 */
export function buildGetRequest(parameters: GetDeveloperProductParameters): HttpRequest {
	return {
		method: "GET",
		url: `/developer-products/v2/universes/${parameters.universeId}/developer-products/${parameters.productId}/creator`,
	};
}

/**
 * Builds a `POST` request for the Open Cloud "create developer product"
 * endpoint.
 *
 * @param parameters - Fields describing the new developer product; optional
 *   values omitted here are left off the multipart payload entirely.
 * @returns A pure {@link HttpRequest} describing the create call.
 */
export function buildCreateRequest(parameters: CreateDeveloperProductParameters): HttpRequest {
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
		url: `/developer-products/v2/universes/${parameters.universeId}/developer-products`,
	};
}

/**
 * Builds a `PATCH` request for the Open Cloud "update developer product"
 * endpoint. Every field on `parameters` except the identifiers is optional;
 * omitted fields are not appended to the multipart body so the server leaves
 * them unchanged.
 *
 * @param parameters - Identifiers plus fields to update.
 * @returns A pure {@link HttpRequest} describing the update call.
 */
export function buildUpdateRequest(parameters: UpdateDeveloperProductParameters): HttpRequest {
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

	if (parameters.storePageEnabled !== undefined) {
		body.append("storePageEnabled", String(parameters.storePageEnabled));
	}

	if (parameters.imageFile !== undefined) {
		body.append("imageFile", toBlob(parameters.imageFile));
	}

	return {
		body,
		method: "PATCH",
		url: `/developer-products/v2/universes/${parameters.universeId}/developer-products/${parameters.productId}`,
	};
}
