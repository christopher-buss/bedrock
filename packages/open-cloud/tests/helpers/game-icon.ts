import type {
	GameIconListWire,
	GetGameIconResponseWire,
} from "#src/domains/game-internationalization/game-icon/wire";

/**
 * Builds a minimally-valid {@link GetGameIconResponseWire} entry. Pass an
 * `overrides` object to tweak individual fields while keeping everything
 * else schema-compliant.
 *
 * @param overrides - Fields to override on the default entry.
 * @returns A valid localized-icon entry with the overrides applied.
 */
export function validLocalizedIcon(
	overrides: Partial<GetGameIconResponseWire> = {},
): GetGameIconResponseWire {
	return {
		imageId: "12345",
		imageUrl: "https://t1.rbxcdn.com/icon/12345",
		languageCode: "en_us",
		state: "Approved",
		...overrides,
	};
}

/**
 * Builds a minimally-valid {@link GameIconListWire} body containing a single
 * default localized icon.
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
