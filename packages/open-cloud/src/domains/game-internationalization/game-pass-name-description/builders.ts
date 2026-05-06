import type { HttpRequest } from "../../../internal/http/types.ts";
import type { UpdateGamePassNameDescriptionParameters } from "./types.ts";

/**
 * Builds a `PATCH` request for the localized "update game-pass
 * name/description" endpoint. Either `name`, `description`, or both may be
 * supplied; omitted fields are not included in the JSON body so the server
 * leaves the existing value for that locale untouched.
 *
 * @param parameters - Game pass and language identifiers plus the optional
 *   replacement values.
 * @returns A pure {@link HttpRequest} describing the update call.
 */
export function buildUpdateRequest(
	parameters: UpdateGamePassNameDescriptionParameters,
): HttpRequest {
	const body: Record<string, string> = {};
	if (parameters.name !== undefined) {
		body["name"] = parameters.name;
	}

	if (parameters.description !== undefined) {
		body["description"] = parameters.description;
	}

	return {
		body,
		method: "PATCH",
		url: `/legacy-game-internationalization/v1/game-passes/${parameters.gamePassId}/name-description/language-codes/${parameters.languageCode}`,
	};
}
