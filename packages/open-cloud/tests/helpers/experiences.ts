import type { UniverseWire } from "#src/resources/experiences/wire";

/**
 * Builds a minimally-valid {@link UniverseWire} body. Pass an
 * `overrides` object to tweak fields without re-stating the defaults.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validUniverseBody(overrides: Partial<UniverseWire> = {}): UniverseWire {
	return {
		ageRating: "AGE_RATING_13_PLUS",
		consoleEnabled: false,
		createTime: "2024-01-15T10:30:00.000Z",
		description: "A sample experience for tests.",
		desktopEnabled: true,
		displayName: "Test Experience",
		mobileEnabled: true,
		path: "universes/12345",
		rootPlace: "universes/12345/places/98765",
		tabletEnabled: true,
		updateTime: "2024-11-02T17:08:21.500Z",
		user: "users/7777",
		visibility: "PUBLIC",
		voiceChatEnabled: false,
		vrEnabled: false,
		...overrides,
	};
}
