import type { SocialLink } from "@bedrock/ocale/universes";

import { describe, expectTypeOf, it } from "vitest";

import type { ResourceKey, RobloxAssetId, Sha256Hex } from "../types/ids.ts";
import type {
	DeveloperProductDesiredState,
	DeveloperProductOutputs,
	GamePassDesiredState,
	GamePassOutputs,
	PlaceDesiredState,
	PlaceOutputs,
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
	ResourceOutputs,
	ResourceOutputsByKind,
	UniverseDesiredState,
	UniverseOutputs,
} from "./resources.ts";

interface ExpectedPlaceDesiredState {
	readonly key: ResourceKey;
	readonly description: string | undefined;
	readonly displayName: string | undefined;
	readonly fileHash: Sha256Hex;
	readonly filePath: string;
	readonly kind: "place";
	readonly placeId: RobloxAssetId;
	readonly serverSize: number | undefined;
}

interface ExpectedPlaceOutputs {
	readonly versionNumber: number;
}

interface ExpectedUniverseDesiredState {
	readonly key: ResourceKey;
	readonly consoleEnabled: boolean | undefined;
	readonly desktopEnabled: boolean | undefined;
	readonly discordSocialLink?: SocialLink | undefined;
	readonly displayName: string | undefined;
	readonly facebookSocialLink?: SocialLink | undefined;
	readonly guildedSocialLink?: SocialLink | undefined;
	readonly kind: "universe";
	readonly mobileEnabled: boolean | undefined;
	readonly privateServerPriceRobux?: number | undefined;
	readonly robloxGroupSocialLink?: SocialLink | undefined;
	readonly tabletEnabled: boolean | undefined;
	readonly twitchSocialLink?: SocialLink | undefined;
	readonly twitterSocialLink?: SocialLink | undefined;
	readonly universeId: RobloxAssetId;
	readonly voiceChatEnabled: boolean | undefined;
	readonly vrEnabled: boolean | undefined;
	readonly youtubeSocialLink?: SocialLink | undefined;
}

interface ExpectedUniverseOutputs {
	readonly rootPlaceId: RobloxAssetId;
}

describe("PlaceDesiredState", () => {
	it("should carry the file-backed fields under kind place", () => {
		expectTypeOf<PlaceDesiredState>().toEqualTypeOf<ExpectedPlaceDesiredState>();
	});
});

describe("PlaceOutputs", () => {
	it("should carry only a readonly versionNumber", () => {
		expectTypeOf<PlaceOutputs>().toEqualTypeOf<ExpectedPlaceOutputs>();
	});
});

describe("UniverseDesiredState", () => {
	it("should carry the singleton fields under kind universe", () => {
		expectTypeOf<UniverseDesiredState>().toEqualTypeOf<ExpectedUniverseDesiredState>();
	});
});

describe("UniverseOutputs", () => {
	it("should carry only a readonly rootPlaceId", () => {
		expectTypeOf<UniverseOutputs>().toEqualTypeOf<ExpectedUniverseOutputs>();
	});
});

describe("ResourceDesiredState", () => {
	it("should narrow to GamePassDesiredState when kind is gamePass", () => {
		expectTypeOf<
			Extract<ResourceDesiredState, { kind: "gamePass" }>
		>().toEqualTypeOf<GamePassDesiredState>();
	});

	it("should narrow to PlaceDesiredState when kind is place", () => {
		expectTypeOf<
			Extract<ResourceDesiredState, { kind: "place" }>
		>().toEqualTypeOf<PlaceDesiredState>();
	});

	it("should narrow to UniverseDesiredState when kind is universe", () => {
		expectTypeOf<
			Extract<ResourceDesiredState, { kind: "universe" }>
		>().toEqualTypeOf<UniverseDesiredState>();
	});

	it("should narrow to DeveloperProductDesiredState when kind is developerProduct", () => {
		expectTypeOf<
			Extract<ResourceDesiredState, { kind: "developerProduct" }>
		>().toEqualTypeOf<DeveloperProductDesiredState>();
	});

	it("should be the union of every managed resource kind", () => {
		expectTypeOf<ResourceDesiredState>().toEqualTypeOf<
			| DeveloperProductDesiredState
			| GamePassDesiredState
			| PlaceDesiredState
			| UniverseDesiredState
		>();
	});
});

describe("ResourceKind", () => {
	it("should include every managed discriminator", () => {
		expectTypeOf<ResourceKind>().toEqualTypeOf<
			"developerProduct" | "gamePass" | "place" | "universe"
		>();
	});
});

describe("ResourceOutputsByKind", () => {
	it("should map the developerProduct kind to DeveloperProductOutputs", () => {
		expectTypeOf<
			ResourceOutputsByKind["developerProduct"]
		>().toEqualTypeOf<DeveloperProductOutputs>();
	});

	it("should map the place kind to PlaceOutputs", () => {
		expectTypeOf<ResourceOutputsByKind["place"]>().toEqualTypeOf<PlaceOutputs>();
	});

	it("should map the gamePass kind to GamePassOutputs", () => {
		expectTypeOf<ResourceOutputsByKind["gamePass"]>().toEqualTypeOf<GamePassOutputs>();
	});

	it("should map the universe kind to UniverseOutputs", () => {
		expectTypeOf<ResourceOutputsByKind["universe"]>().toEqualTypeOf<UniverseOutputs>();
	});
});

describe("ResourceOutputs", () => {
	it("should resolve developerProduct to DeveloperProductOutputs", () => {
		expectTypeOf<
			ResourceOutputs<"developerProduct">
		>().toEqualTypeOf<DeveloperProductOutputs>();
	});

	it("should resolve gamePass to GamePassOutputs", () => {
		expectTypeOf<ResourceOutputs<"gamePass">>().toEqualTypeOf<GamePassOutputs>();
	});

	it("should resolve place to PlaceOutputs", () => {
		expectTypeOf<ResourceOutputs<"place">>().toEqualTypeOf<PlaceOutputs>();
	});

	it("should resolve universe to UniverseOutputs", () => {
		expectTypeOf<ResourceOutputs<"universe">>().toEqualTypeOf<UniverseOutputs>();
	});

	it("should reject an unmapped resource kind at compile time", () => {
		type UnmappedKind = "nonexistent";
		// @ts-expect-error UnmappedKind does not extend ResourceKind, so the
		// generic constraint on ResourceOutputs refuses the lookup.
		expectTypeOf<ResourceOutputs<UnmappedKind>>().toBeObject();
	});
});

describe("ResourceCurrentState per-kind narrowing", () => {
	it("should attach DeveloperProductOutputs under outputs when narrowed to developerProduct", () => {
		type Current = ResourceCurrentState<"developerProduct">;
		expectTypeOf<Current["kind"]>().toEqualTypeOf<"developerProduct">();
		expectTypeOf<Current["outputs"]>().toEqualTypeOf<DeveloperProductOutputs>();
		expectTypeOf<Current>().toExtend<DeveloperProductDesiredState>();
	});

	it("should attach GamePassOutputs under outputs when narrowed to gamePass", () => {
		type Current = ResourceCurrentState<"gamePass">;
		expectTypeOf<Current["kind"]>().toEqualTypeOf<"gamePass">();
		expectTypeOf<Current["outputs"]>().toEqualTypeOf<GamePassOutputs>();
		expectTypeOf<Current>().toExtend<GamePassDesiredState>();
	});

	it("should attach PlaceOutputs under outputs when narrowed to place", () => {
		type Current = ResourceCurrentState<"place">;
		expectTypeOf<Current["kind"]>().toEqualTypeOf<"place">();
		expectTypeOf<Current["outputs"]>().toEqualTypeOf<PlaceOutputs>();
		expectTypeOf<Current>().toExtend<PlaceDesiredState>();
	});

	it("should attach UniverseOutputs under outputs when narrowed to universe", () => {
		type Current = ResourceCurrentState<"universe">;
		expectTypeOf<Current["kind"]>().toEqualTypeOf<"universe">();
		expectTypeOf<Current["outputs"]>().toEqualTypeOf<UniverseOutputs>();
		expectTypeOf<Current>().toExtend<UniverseDesiredState>();
	});
});

describe("ResourceCurrentState distribution", () => {
	it("should distribute over K so the default union stays per-kind", () => {
		expectTypeOf<ResourceCurrentState>().toEqualTypeOf<
			| ResourceCurrentState<"developerProduct">
			| ResourceCurrentState<"gamePass">
			| ResourceCurrentState<"place">
			| ResourceCurrentState<"universe">
		>();
	});
});
