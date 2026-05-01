import type { UpdateUniverseParameters } from "#src/domains/cloud-v2/universes/types";
import { describe, expect, expectTypeOf, it } from "vitest";

import { listWritablePropertyNames } from "./_helpers.ts";

/**
 * Hand-mirrored set of every writable field exposed by
 * `UpdateUniverseParameters`. Source-of-truth for two paired checks:
 *
 * - the type-level pin asserts the array is exhaustive against the
 *   parameter interface (minus the `universeId` URL field), so a new
 *   parameter cannot land without an entry here;
 * - the runtime drift check asserts every entry is non-`readOnly` on
 *   the OpenAPI `Universe` schema, so an entry cannot name a server-
 *   side readOnly field (the regression behind the silently-dropped
 *   `visibility` write-path).
 */
const UPDATE_UNIVERSE_PARAMETER_KEYS = [
	"consoleEnabled",
	"desktopEnabled",
	"discordSocialLink",
	"facebookSocialLink",
	"guildedSocialLink",
	"mobileEnabled",
	"privateServerPriceRobux",
	"robloxGroupSocialLink",
	"tabletEnabled",
	"twitchSocialLink",
	"twitterSocialLink",
	"voiceChatEnabled",
	"vrEnabled",
	"youtubeSocialLink",
] as const;

type UpdateUniverseParameterKey = (typeof UPDATE_UNIVERSE_PARAMETER_KEYS)[number];

// Type-level pin: every key in the parameter interface (minus the
// universeId URL field) must appear in the const array, and the array
// must not name a key that is not in the interface. Lives at module
// scope because `expectTypeOf` is a no-op at runtime; wrapping it in
// `it()` would trip the assertion-count lint without adding signal.
expectTypeOf<UpdateUniverseParameterKey>().toEqualTypeOf<
	Exclude<keyof UpdateUniverseParameters, "universeId">
>();

describe("updateUniverseParameters writable-keys pin", () => {
	it.for(UPDATE_UNIVERSE_PARAMETER_KEYS)(
		"should expose %s as a non-readOnly property on the Universe schema",
		(key) => {
			expect.assertions(1);
			expect(listWritablePropertyNames("Universe")).toContain(key);
		},
	);
});
