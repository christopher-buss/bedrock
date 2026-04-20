import { RBXL_SIGNATURE, RBXLX_SIGNATURE } from "#src/resources/places/signatures";
import type { PlaceVersionWire } from "#src/resources/places/wire";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/places/", import.meta.url));

/**
 * Reads one of the binary place fixtures from `tests/fixtures/places/`.
 *
 * @param name - The fixture filename (e.g. `"minimal.rbxl"`).
 * @returns The fixture bytes as a fresh `Uint8Array`.
 */
export function loadPlaceFixture(name: string): Uint8Array<ArrayBuffer> {
	const buffer = readFileSync(`${FIXTURES_DIR}${name}`);
	return new Uint8Array(
		buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
	);
}

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
