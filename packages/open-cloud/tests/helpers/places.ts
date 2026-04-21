import { RBXL_SIGNATURE, RBXLX_SIGNATURE } from "#src/resources/places/signatures";
import type { PlaceVersionWire } from "#src/resources/places/wire";

/**
 * Returns a fresh, minimal `.rbxl`-formatted body whose magic bytes
 * match {@link RBXL_SIGNATURE}. Useful when integration tests don't
 * care about the file's contents past the signature.
 *
 * @returns A 14-byte rbxl body matching the binary signature.
 */
export function rbxlBody(): Uint8Array<ArrayBuffer> {
	return new Uint8Array(RBXL_SIGNATURE);
}

/**
 * Returns a fresh, minimal `.rbxlx`-formatted body whose magic bytes
 * match {@link RBXLX_SIGNATURE}. Useful when integration tests don't
 * care about the file's contents past the signature.
 *
 * @returns An 8-byte rbxlx body matching the XML signature.
 */
export function rbxlxBody(): Uint8Array<ArrayBuffer> {
	return new Uint8Array(RBXLX_SIGNATURE);
}

/**
 * Builds a minimally-valid {@link PlaceVersionWire} body. Pass an
 * `overrides` object to tweak fields without re-stating the defaults.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validPublishResponseBody(
	overrides: Partial<PlaceVersionWire> = {},
): PlaceVersionWire {
	return {
		versionNumber: 1,
		...overrides,
	};
}
