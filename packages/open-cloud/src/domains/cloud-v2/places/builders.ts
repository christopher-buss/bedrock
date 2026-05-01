import type { HttpRequest } from "../../../client/types.ts";
import { ValidationError } from "../../../errors/validation.ts";
import type { Result } from "../../../types.ts";
import type { UpdatePlaceParameters } from "./types.ts";

const NON_UPDATABLE_KEYS: ReadonlySet<string> = new Set(["placeId", "universeId"]);

/**
 * Builds a `PATCH` request for the Open Cloud "update place" endpoint.
 * Derives the `updateMask` query string from the keys present on
 * `parameters` (excluding the identifiers) and emits a JSON body
 * containing those same fields.
 *
 * @param parameters - The universe and place identifiers plus the fields
 *   to update.
 * @returns A success result wrapping the request, or a
 *   {@link ValidationError} when no updatable fields were supplied.
 */
export function buildUpdateRequest(
	parameters: UpdatePlaceParameters,
): Result<HttpRequest, ValidationError> {
	const fieldKeys = extractUpdateFieldKeys(parameters);

	if (fieldKeys.length === 0) {
		return {
			err: new ValidationError("Update must include at least one field", {
				code: "empty_update",
			}),
			success: false,
		};
	}

	const body = Object.fromEntries(
		fieldKeys.map((key): readonly [string, unknown] => [key, Reflect.get(parameters, key)]),
	);
	const updateMask = fieldKeys.join(",");
	const { placeId, universeId } = parameters;
	return {
		data: {
			body,
			headers: { "content-type": "application/json" },
			method: "PATCH",
			url: `/cloud/v2/universes/${universeId}/places/${placeId}?updateMask=${updateMask}`,
		},
		success: true,
	};
}

function extractUpdateFieldKeys(parameters: UpdatePlaceParameters): ReadonlyArray<string> {
	return Object.keys(parameters).filter((key) => !NON_UPDATABLE_KEYS.has(key));
}
