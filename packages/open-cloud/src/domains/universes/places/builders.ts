import type { HttpRequest } from "../../../client/types.ts";
import { ValidationError } from "../../../errors/validation.ts";
import type { Result } from "../../../types.ts";
import { matchesSignature, RBXL_SIGNATURE, RBXLX_SIGNATURE } from "./signatures.ts";
import type { PublishParameters } from "./types.ts";

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
 * The request carries `connection: close`. Roblox's edge gateway discards
 * idle keep-alive connections faster than a pooling `fetch` implementation
 * expects, and a publish written into a discarded connection never reaches
 * Open Cloud: it surfaces as a gateway error page or a socket reset minutes
 * later, having created no version. Opting the upload out of connection reuse
 * costs one handshake per publish and removes the race. Small, frequent calls
 * on other endpoints keep their pooled connections.
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

	const validationError = validateBody(body, format);
	if (validationError !== undefined) {
		return { err: validationError, success: false };
	}

	return {
		data: {
			body,
			headers: {
				"connection": "close",
				"content-type": CONTENT_TYPE_BY_FORMAT[format],
			},
			method: "POST",
			url: `/universes/v1/${universeId}/places/${placeId}/versions?versionType=${versionType}`,
		},
		success: true,
	};
}

/**
 * Checks a place body against the format its caller declared: non-empty, and
 * carrying the magic bytes of `format`. Emptiness is checked first so a
 * zero-byte body reports `empty_body` rather than a signature mismatch.
 *
 * @param body - The raw place file bytes.
 * @param format - The format the caller declared the bytes to be in.
 * @returns The {@link ValidationError} to fail with, or `undefined` when the
 *   body is usable.
 */
function validateBody(
	body: PublishParameters["body"],
	format: PublishParameters["format"],
): undefined | ValidationError {
	if (body.length === 0) {
		return new ValidationError("Place body is empty", { code: "empty_body" });
	}

	const expectedSignature = format === "rbxl" ? RBXL_SIGNATURE : RBXLX_SIGNATURE;
	if (!matchesSignature(body, expectedSignature)) {
		return new ValidationError(`Place body does not match the declared "${format}" format`, {
			code: "format_mismatch",
		});
	}

	return undefined;
}
