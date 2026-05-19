import { describe, expectTypeOf, it } from "vitest";

import type {
	Config,
	EnvironmentEntry,
	GamePassEntry,
	PlaceEntry,
	RedactedGamePassOverride,
	ResolvedPlaceEntry,
	ResolvedUniverseEntry,
	StateConfig,
	UniverseEntry,
} from "./schema.ts";

const STATE: StateConfig = { backend: "gist", gistId: "test" };

describe("Config", () => {
	it("should require environments to be a Record of EnvironmentEntry rather than optional", () => {
		expectTypeOf<Config["environments"]>().not.toBeUndefined();
	});

	it("should reject Config that omits the required environments field", () => {
		// @ts-expect-error environments is required and must be present.
		const config: Config = { state: STATE };
		expectTypeOf(config).toExtend<Config>();
	});

	it("should accept Config with root state plus environments without state on each entry", () => {
		const config = {
			environments: { production: {} },
			state: STATE,
		} as const satisfies Config;
		expectTypeOf(config).toExtend<Config>();
	});

	it("should accept Config with no root state when every environment entry carries its own state", () => {
		const config = {
			environments: {
				production: { state: STATE },
				staging: { state: STATE },
			},
		} as const satisfies Config;
		expectTypeOf(config).toExtend<Config>();
	});

	it("should narrow state on Config to StateConfig | undefined so the deploy boundary handles the missing case", () => {
		expectTypeOf<Config["state"]>().toEqualTypeOf<StateConfig | undefined>();
	});
});

type PlaceOverlayEntry = NonNullable<EnvironmentEntry["places"]>[string];
type UniverseOverlayEntry = NonNullable<EnvironmentEntry["universe"]>;
type PassesOverlayEntry = NonNullable<EnvironmentEntry["passes"]>[string];

describe("EnvironmentEntry overlay shapes", () => {
	it("should require placeId on a places overlay entry while making other fields optional", () => {
		const overlay = { placeId: "1234" } as const satisfies PlaceOverlayEntry;
		expectTypeOf(overlay).toExtend<PlaceOverlayEntry>();
	});

	it("should reject a places overlay entry that omits placeId", () => {
		// @ts-expect-error placeId is required on every places overlay entry.
		const overlay: PlaceOverlayEntry = { filePath: "places/staging.rbxl" };
		expectTypeOf(overlay).toExtend<PlaceOverlayEntry>();
	});

	it("should accept a universe overlay declaring only universeId", () => {
		const overlay = { universeId: "9999999999" } as const satisfies UniverseOverlayEntry;
		expectTypeOf(overlay).toExtend<UniverseOverlayEntry>();
	});

	it("should accept a universe overlay that omits universeId in favour of root authority", () => {
		const overlay = { voiceChatEnabled: true } as const satisfies UniverseOverlayEntry;
		expectTypeOf(overlay).toExtend<UniverseOverlayEntry>();
	});

	it("should keep every universe overlay field optional so the runtime XOR rule decides whether universeId must appear", () => {
		const overlay = {} as const satisfies UniverseOverlayEntry;
		expectTypeOf(overlay).toExtend<UniverseOverlayEntry>();
	});

	it("should keep every passes overlay field optional", () => {
		const overlay = {} as const satisfies PassesOverlayEntry;
		expectTypeOf(overlay).toExtend<PassesOverlayEntry>();
	});
});

describe("EnvironmentEntry passes overlay redacted shape", () => {
	it("should accept boolean and the per-field RedactedGamePassOverride object alike", () => {
		expectTypeOf<PassesOverlayEntry["redacted"]>().toEqualTypeOf<
			boolean | RedactedGamePassOverride | undefined
		>();
	});

	it("should accept a passes overlay entry that declares the redacted object override form", () => {
		const overlay = {
			redacted: { name: "Closed Beta" },
		} as const satisfies PassesOverlayEntry;
		expectTypeOf(overlay).toExtend<PassesOverlayEntry>();
	});

	it("should still accept a passes overlay entry that declares redacted as a boolean", () => {
		const overlay = { redacted: true } as const satisfies PassesOverlayEntry;
		expectTypeOf(overlay).toExtend<PassesOverlayEntry>();
	});
});

describe("EnvironmentEntry overlay derivation", () => {
	it("should match the keys of GamePassEntry on a passes overlay entry", () => {
		expectTypeOf<keyof PassesOverlayEntry>().toEqualTypeOf<keyof GamePassEntry>();
	});

	it("should match the keys of ResolvedPlaceEntry on a places overlay entry", () => {
		expectTypeOf<keyof PlaceOverlayEntry>().toEqualTypeOf<keyof ResolvedPlaceEntry>();
	});

	it("should match the keys of UniverseEntry on a universe overlay", () => {
		expectTypeOf<keyof UniverseOverlayEntry>().toEqualTypeOf<keyof UniverseEntry>();
	});
});

describe("Config XOR — accepted root shapes", () => {
	it("should accept a config that declares universeId on the root universe block only", () => {
		const config = {
			environments: { production: {} },
			universe: { universeId: "111" },
		} as const satisfies Config;
		expectTypeOf(config).toExtend<Config>();
	});

	it("should accept a config that omits the universe block at the root and on every environment", () => {
		const config = {
			environments: { production: {} },
		} as const satisfies Config;
		expectTypeOf(config).toExtend<Config>();
	});
});

describe("Config XOR — accepted env shapes", () => {
	it("should accept a config that declares universeId on every environment overlay only", () => {
		const config = {
			environments: {
				production: { universe: { universeId: "111" } },
				staging: { universe: { universeId: "222" } },
			},
		} as const satisfies Config;
		expectTypeOf(config).toExtend<Config>();
	});

	it("should accept a root universe block carrying shared fields without universeId when every env supplies one", () => {
		const config = {
			environments: {
				production: { universe: { universeId: "111" } },
			},
			universe: { desktopEnabled: true, voiceChatEnabled: true },
		} as const satisfies Config;
		expectTypeOf(config).toExtend<Config>();
	});
});

describe("Config XOR — rejected shapes", () => {
	it("should reject a config that declares universeId on both the root and an environment overlay", () => {
		// @ts-expect-error universeId on root and per-env overlay must not
		// coexist.
		const config: Config = {
			environments: { production: { universe: { universeId: "999" } } },
			universe: { universeId: "111" },
		};
		expectTypeOf(config).toExtend<Config>();
	});

	it("should reject root universeId paired with an env overlay that also declares one in any other environment slot", () => {
		// @ts-expect-error universeId on root and per-env overlay must not
		// coexist.
		const config: Config = {
			environments: {
				staging: { universe: { universeId: "222" } },
			},
			universe: { universeId: "111" },
		};
		expectTypeOf(config).toExtend<Config>();
	});
});

describe("UniverseEntry / ResolvedUniverseEntry split", () => {
	it("should expose universeId as optional on the authored UniverseEntry so authors can supply it per-environment", () => {
		expectTypeOf<UniverseEntry["universeId"]>().toEqualTypeOf<string | undefined>();
	});

	it("should require universeId on the post-merge ResolvedUniverseEntry as the resolution-boundary invariant", () => {
		expectTypeOf<ResolvedUniverseEntry["universeId"]>().toEqualTypeOf<string>();
	});

	it("should make ResolvedUniverseEntry assignable to UniverseEntry but not the reverse", () => {
		expectTypeOf<ResolvedUniverseEntry>().toExtend<UniverseEntry>();
		expectTypeOf<UniverseEntry>().not.toExtend<ResolvedUniverseEntry>();
	});

	it("should leave every non-identity universe field optional on both sides of the split", () => {
		expectTypeOf<UniverseEntry["voiceChatEnabled"]>().toEqualTypeOf<boolean | undefined>();
		expectTypeOf<ResolvedUniverseEntry["voiceChatEnabled"]>().toEqualTypeOf<
			boolean | undefined
		>();
	});
});

describe("PlaceEntry / ResolvedPlaceEntry split", () => {
	it("should expose filePath plus the optional metadata fields at the root PlaceEntry level", () => {
		expectTypeOf<keyof PlaceEntry>().toEqualTypeOf<
			"description" | "displayName" | "filePath" | "redacted" | "serverSize"
		>();
		expectTypeOf<PlaceEntry["filePath"]>().toEqualTypeOf<string>();
		expectTypeOf<PlaceEntry["displayName"]>().toEqualTypeOf<string | undefined>();
		expectTypeOf<PlaceEntry["description"]>().toEqualTypeOf<string | undefined>();
		expectTypeOf<PlaceEntry["serverSize"]>().toEqualTypeOf<number | undefined>();
	});

	it("should add placeId on ResolvedPlaceEntry as the post-merge invariant alongside the metadata fields", () => {
		expectTypeOf<keyof ResolvedPlaceEntry>().toEqualTypeOf<
			"description" | "displayName" | "filePath" | "placeId" | "redacted" | "serverSize"
		>();
		expectTypeOf<ResolvedPlaceEntry["filePath"]>().toEqualTypeOf<string>();
		expectTypeOf<ResolvedPlaceEntry["placeId"]>().toEqualTypeOf<string>();
	});

	it("should make ResolvedPlaceEntry assignable to PlaceEntry but not the reverse", () => {
		expectTypeOf<ResolvedPlaceEntry>().toExtend<PlaceEntry>();
		expectTypeOf<PlaceEntry>().not.toExtend<ResolvedPlaceEntry>();
	});
});

// Some Config keys are deliberately not environment-overridable, and some
// EnvironmentEntry fields carry environment-only metadata that has no Config
// counterpart. Adding to or removing from these unions is the explicit way to
// opt new fields out of the symmetric overlay surface.
type NonOverridableConfigKey = "displayNamePrefix" | "environments" | "extends";
type EnvironmentMetadataKey = "label" | "redacted";
type OverridableConfigKey = Exclude<keyof Config, NonOverridableConfigKey>;
type EnvironmentEntryKey = Exclude<keyof Required<EnvironmentEntry>, EnvironmentMetadataKey>;

type MissingOverlayKeys = Exclude<OverridableConfigKey, EnvironmentEntryKey>;
type ExtraOverlayKeys = Exclude<EnvironmentEntryKey, OverridableConfigKey>;

// Compile-time assertions surface as descriptive string-literal types when
// they fail. `MissingOverlayKeys` and `ExtraOverlayKeys` should both be
// `never`; if a contributor adds a Config field without declaring an
// overlay for it (or vice versa), the assertion's failed type names the
// offending key directly in the error message.
type AssertNoMissingOverlay = [MissingOverlayKeys] extends [never]
	? true
	: `EnvironmentEntry is missing an overlay field for Config keys: ${Extract<MissingOverlayKeys, string>}. Add the field with the correct overlay shape, or add the key name to NonOverridableConfigKey if it should be deliberately excluded.`;

type AssertNoExtraOverlay = [ExtraOverlayKeys] extends [never]
	? true
	: `EnvironmentEntry declares overlay fields for keys not present in Config's overridable set: ${Extract<ExtraOverlayKeys, string>}. Either remove the field, add the corresponding Config field, or add the key name to EnvironmentMetadataKey if it should be deliberately excluded as environment-only metadata.`;

describe("EnvironmentEntry exhaustiveness", () => {
	it("should declare an overlay field for every overridable Config key", () => {
		expectTypeOf<AssertNoMissingOverlay>().toEqualTypeOf<true>();
	});

	it("should not declare overlay fields for keys outside Config's overridable set", () => {
		expectTypeOf<AssertNoExtraOverlay>().toEqualTypeOf<true>();
	});
});
