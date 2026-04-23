import { describe, expectTypeOf, it } from "vitest";

import type { ResourceKey, RobloxAssetId, Sha256Hex } from "../types/ids.ts";
import type {
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
	readonly fileHash: Sha256Hex;
	readonly filePath: string;
	readonly kind: "place";
	readonly placeId: RobloxAssetId;
}

interface ExpectedPlaceOutputs {
	readonly versionNumber: number;
}

interface ExpectedUniverseDesiredState {
	readonly key: ResourceKey;
	readonly kind: "universe";
	readonly universeId: RobloxAssetId;
	readonly voiceChatEnabled: boolean | undefined;
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

	it("should be the union of every managed resource kind", () => {
		expectTypeOf<ResourceDesiredState>().toEqualTypeOf<
			GamePassDesiredState | PlaceDesiredState | UniverseDesiredState
		>();
	});
});

describe("ResourceKind", () => {
	it("should include every managed discriminator", () => {
		expectTypeOf<ResourceKind>().toEqualTypeOf<"gamePass" | "place" | "universe">();
	});
});

describe("ResourceOutputsByKind", () => {
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

describe("ResourceCurrentState", () => {
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

	it("should distribute over K so the default union stays per-kind", () => {
		expectTypeOf<ResourceCurrentState>().toEqualTypeOf<
			| ResourceCurrentState<"gamePass">
			| ResourceCurrentState<"place">
			| ResourceCurrentState<"universe">
		>();
	});
});
