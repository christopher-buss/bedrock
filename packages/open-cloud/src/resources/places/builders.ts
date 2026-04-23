import type { HttpRequest } from "../../client/types.ts";
import { ValidationError } from "../../errors/validation.ts";
import type { Result } from "../../types.ts";
import { matchesSignature, RBXL_SIGNATURE, RBXLX_SIGNATURE } from "./signatures.ts";
import type { PublishParameters, UpdatePlaceParameters } from "./types.ts";

/**
 * Whether a publish call writes a live (`Published`) or draft (`Saved`)
 * version. Surfaces only as the `versionType` query string on the
 * underlying HTTP request.
 */
type VersionType = "Published" | "Saved";

const CONTENT_TYPE_BY_FORMAT: Readonly<Record<PublishParameters["format"], string>> = {
	rbxl: "application/octet-stream",
	rbxlx: "application/xml",
};

/**
 * Builds a `POST` request for the Open Cloud "publish place version"
 * endpoint. Performs two local validations before producing any
 * {@link HttpRequest}: a non-empty body check and a magic-byte check
 * that the bytes' actual format matches `parameters.format`.
 *
 * @param parameters - Universe and place identifiers, the place file
 *   bytes, and the declared `format` of those bytes.
 * @param versionType - `"Published"` for `publish()`, `"Saved"` for
 *   `save()`; baked into the `?versionType=` query string.
 * @returns A success result wrapping the request on success, or a
 *   {@link ValidationError} when the body is empty or its magic bytes
 *   disagree with `parameters.format`.
 */
export function buildPublishRequest(
	parameters: PublishParameters,
	versionType: VersionType,
): Result<HttpRequest, ValidationError> {
	const { body, format, placeId, universeId } = parameters;

	if (body.length === 0) {
		return {
			err: new ValidationError("Place body is empty", { code: "empty_body" }),
			success: false,
		};
	}

	const expectedSignature = format === "rbxl" ? RBXL_SIGNATURE : RBXLX_SIGNATURE;
	if (!matchesSignature(body, expectedSignature)) {
		return {
			err: new ValidationError(`Place body does not match the declared "${format}" format`, {
				code: "format_mismatch",
			}),
			success: false,
		};
	}

	return {
		data: {
			body,
			headers: { "content-type": CONTENT_TYPE_BY_FORMAT[format] },
			method: "POST",
			url: `/universes/v1/${universeId}/places/${placeId}/versions?versionType=${versionType}`,
		},
		success: true,
	};
}

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
