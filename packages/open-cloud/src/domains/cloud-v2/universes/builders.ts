import type { HttpRequest } from "../../../client/types.ts";
import type { OpenCloudError } from "../../../errors/base.ts";
import { ValidationError } from "../../../errors/validation.ts";
import { okRequest } from "../../../internal/resource-client.ts";
import type { Result } from "../../../types.ts";
import type {
	GetUniverseParameters,
	UniverseVisibility,
	UpdateUniverseParameters,
} from "./types.ts";
import type { VisibilityWire } from "./wire.ts";

/**
 * Dodges `unicorn/no-null` while still emitting a literal `null` onto
 * the wire, which the Open Cloud `Cloud_UpdateUniverse` endpoint
 * requires to clear a nullable field (for example disabling private
 * servers or removing a social link).
 */
const NULL_SENTINEL = JSON.parse("null");

const VISIBILITY_WIRE_MAP: Readonly<Record<UniverseVisibility, VisibilityWire>> = {
	private: "PRIVATE",
	public: "PUBLIC",
	unspecified: "VISIBILITY_UNSPECIFIED",
};

/**
 * Builds a `GET` request for the Open Cloud "get universe" endpoint.
 *
 * @param parameters - The universe identifier.
 * @returns A success result wrapping the request; the builder cannot fail.
 */
export function buildGetRequest(
	parameters: GetUniverseParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest({
		method: "GET",
		url: `/cloud/v2/universes/${parameters.universeId}`,
	});
}

/**
 * Builds a `PATCH` request for the Open Cloud "update universe"
 * endpoint. Derives the `updateMask` query string from the keys
 * present on `parameters` and emits a JSON body containing those same
 * fields, translating `undefined` values to JSON `null` so Roblox
 * clears the corresponding server-side value.
 *
 * @param parameters - The universe identifier plus the fields to update.
 * @returns A success result wrapping the request, or a
 *   {@link ValidationError} when no updatable fields were supplied.
 */
export function buildUpdateRequest(
	parameters: UpdateUniverseParameters,
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

	const body: Record<string, unknown> = {};
	for (const key of fieldKeys) {
		body[key] = bodyValueFor(parameters, key);
	}

	const updateMask = fieldKeys.join(",");
	return {
		data: {
			body,
			headers: { "content-type": "application/json" },
			method: "PATCH",
			url: `/cloud/v2/universes/${parameters.universeId}?updateMask=${updateMask}`,
		},
		success: true,
	};
}

function extractUpdateFieldKeys(parameters: UpdateUniverseParameters): ReadonlyArray<string> {
	return Object.keys(parameters).filter((key) => key !== "universeId");
}

function bodyValueFor(parameters: UpdateUniverseParameters, key: string): unknown {
	if (key === "visibility") {
		const { visibility } = parameters;
		return visibility === undefined ? NULL_SENTINEL : VISIBILITY_WIRE_MAP[visibility];
	}

	const value = Reflect.get(parameters, key);
	return value === undefined ? NULL_SENTINEL : value;
}
