import { describe, expectTypeOf, it } from "vitest";

import type { ResourceKey, RobloxAssetId, Sha256Hex } from "../types/ids.ts";
import type {
	GamePassDesiredState,
	GamePassOutputs,
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
	ResourceOutputs,
} from "./resources.ts";

describe("ResourceDesiredState", () => {
	it("should narrow to GamePassDesiredState when kind is gamePass", () => {
		expectTypeOf<
			Extract<ResourceDesiredState, { kind: "gamePass" }>
		>().toEqualTypeOf<GamePassDesiredState>();
	});
});

describe("ResourceKind", () => {
	it("should equal the gamePass discriminator literal", () => {
		expectTypeOf<ResourceKind>().toEqualTypeOf<"gamePass">();
	});
});

describe("ResourceOutputs", () => {
	it("should resolve gamePass to GamePassOutputs", () => {
		expectTypeOf<ResourceOutputs<"gamePass">>().toEqualTypeOf<GamePassOutputs>();
	});

	it("should reject an unmapped resource kind at compile time", () => {
		type UnmappedKind = "experience";
		// @ts-expect-error UnmappedKind does not extend ResourceKind, so the
		// generic constraint on ResourceOutputs refuses the lookup.
		expectTypeOf<ResourceOutputs<UnmappedKind>>().toBeObject();
	});
});

describe("ResourceCurrentState", () => {
	it("should compose gamePass desired fields with a nested outputs object", () => {
		expectTypeOf<ResourceCurrentState>().toEqualTypeOf<{
			readonly description: string;
			readonly iconFileHash: Sha256Hex;
			readonly iconFilePath: string;
			readonly key: ResourceKey;
			readonly kind: "gamePass";
			readonly name: string;
			readonly outputs: {
				readonly assetId: RobloxAssetId;
				readonly iconAssetId: RobloxAssetId;
			};
			readonly price: number | undefined;
		}>();
	});

	it("should default K to the full ResourceKind union", () => {
		expectTypeOf<ResourceCurrentState>().toEqualTypeOf<ResourceCurrentState>();
	});
});
