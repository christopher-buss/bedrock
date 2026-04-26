import type { GameThumbnailUploadWire } from "#src/resources/experience-thumbnails/wire";

/**
 * Builds a minimally-valid {@link GameThumbnailUploadWire} body. Pass an
 * `overrides` object to tweak individual fields while keeping everything
 * else schema-compliant; useful for parser and integration tests that
 * only care about one field at a time.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validThumbnailUploadBody(
	overrides: Partial<GameThumbnailUploadWire> = {},
): GameThumbnailUploadWire {
	return { mediaAssetId: "67890", ...overrides };
}
