import { describe, expectTypeOf, it } from "vitest";

import type {
	Config,
	EnvironmentEntry,
	GamePassEntry,
	PlaceEntry,
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

	it("should match the keys of PlaceEntry on a places overlay entry", () => {
		expectTypeOf<keyof PlaceOverlayEntry>().toEqualTypeOf<keyof PlaceEntry>();
	});

	it("should match the keys of UniverseEntry on a universe overlay", () => {
		expectTypeOf<keyof UniverseOverlayEntry>().toEqualTypeOf<keyof UniverseEntry>();
	});
});
