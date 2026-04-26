import { describe, expectTypeOf, it } from "vitest";

import type {
	Config,
	EnvironmentEntry,
	GamePassEntry,
	PlaceEntry,
	ResolvedPlaceEntry,
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

	it("should require universeId on a universe overlay while making other fields optional", () => {
		const overlay = { universeId: "9999999999" } as const satisfies UniverseOverlayEntry;
		expectTypeOf(overlay).toExtend<UniverseOverlayEntry>();
	});

	it("should reject a universe overlay that omits universeId", () => {
		// @ts-expect-error universeId is required on a universe overlay.
		const overlay: UniverseOverlayEntry = { voiceChatEnabled: true };
		expectTypeOf(overlay).toExtend<UniverseOverlayEntry>();
	});

	it("should keep every passes overlay field optional", () => {
		const overlay = {} as const satisfies PassesOverlayEntry;
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

describe("PlaceEntry / ResolvedPlaceEntry split", () => {
	it("should expose only filePath at the root PlaceEntry level", () => {
		expectTypeOf<keyof PlaceEntry>().toEqualTypeOf<"filePath">();
		expectTypeOf<PlaceEntry["filePath"]>().toEqualTypeOf<string>();
	});

	it("should expose filePath and placeId on ResolvedPlaceEntry as the post-merge invariant", () => {
		expectTypeOf<keyof ResolvedPlaceEntry>().toEqualTypeOf<"filePath" | "placeId">();
		expectTypeOf<ResolvedPlaceEntry["filePath"]>().toEqualTypeOf<string>();
		expectTypeOf<ResolvedPlaceEntry["placeId"]>().toEqualTypeOf<string>();
	});

	it("should make ResolvedPlaceEntry assignable to PlaceEntry but not the reverse", () => {
		expectTypeOf<ResolvedPlaceEntry>().toExtend<PlaceEntry>();
		expectTypeOf<PlaceEntry>().not.toExtend<ResolvedPlaceEntry>();
	});
});

// Two Config keys are deliberately not environment-overridable. Adding to or
// removing from this union is the explicit way to opt new fields out of the
// per-environment overlay surface.
type NonOverridableConfigKey = "environments" | "extends";
type OverridableConfigKey = Exclude<keyof Config, NonOverridableConfigKey>;
type EnvironmentEntryKey = keyof Required<EnvironmentEntry>;

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
	: `EnvironmentEntry declares overlay fields for keys not present in Config's overridable set: ${Extract<ExtraOverlayKeys, string>}. Either remove the field, add the corresponding Config field, or move the key out of NonOverridableConfigKey.`;

describe("EnvironmentEntry exhaustiveness", () => {
	it("should declare an overlay field for every overridable Config key", () => {
		expectTypeOf<AssertNoMissingOverlay>().toEqualTypeOf<true>();
	});

	it("should not declare overlay fields for keys outside Config's overridable set", () => {
		expectTypeOf<AssertNoExtraOverlay>().toEqualTypeOf<true>();
	});
});
