import type {
	GameIconListWire,
	GameIconUploadWire,
	LocalizedGameIconWire,
} from "#src/resources/experience-icon/wire";

/**
 * Builds a minimally-valid {@link GameIconUploadWire} body. Pass an
 * `overrides` object to tweak individual fields while keeping everything
 * else schema-compliant; useful for parser and integration tests that
 * only care about one field at a time.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validIconUploadBody(
	overrides: Partial<GameIconUploadWire> = {},
): GameIconUploadWire {
	return {
		mediaAssetId: 12_345,
		...overrides,
	};
}

/**
 * Builds a minimally-valid {@link LocalizedGameIconWire} entry.
 *
 * @param overrides - Fields to override on the default entry.
 * @returns A valid localized-icon entry with the overrides applied.
 */
export function validLocalizedIcon(
	overrides: Partial<LocalizedGameIconWire> = {},
): LocalizedGameIconWire {
	return {
		languageCode: "en-us",
		mediaAssetId: 12_345,
		...overrides,
	};
}

/**
 * Builds a minimally-valid {@link GameIconListWire} body containing a
 * single default localized icon.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validIconListBody(overrides: Partial<GameIconListWire> = {}): GameIconListWire {
	return {
		data: [validLocalizedIcon()],
		...overrides,
	};
}
