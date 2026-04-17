import type { HttpRequest } from "../../internal/http/types.ts";
import type { CreateGamePassParameters, GetGamePassParameters } from "./types.ts";

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

/**
 * Builds a `POST` request for the Open Cloud "create game pass" endpoint.
 *
 * @param params - Parameters describing the new game pass.
 * @returns A pure {@link HttpRequest} describing the create call.
 */
export function buildCreateRequest(
	params: CreateGamePassParameters,
): HttpRequest {
	const body = new FormData();
	body.append("name", params.name);
	appendIfDefined(body, "description", params.description);
	appendIfDefined(body, "isForSale", params.isForSale);
	appendIfDefined(body, "price", params.price);
	appendIfDefined(
		body,
		"isRegionalPricingEnabled",
		params.isRegionalPricingEnabled,
	);

	return {
		body,
		method: "POST",
		url: `/game-passes/v1/universes/${params.universeId}/game-passes`,
	};
}

/**
 * Appends a value to `body` under `name` when it is defined, coercing
 * non-string scalars via `String()`. Undefined values are skipped so that
 * `"undefined"` never leaks into the multipart payload.
 */
function appendIfDefined(
	body: FormData,
	name: string,
	value: boolean | number | string | undefined,
): void {
	if (value !== undefined) {
		body.append(name, String(value));
	}
}
