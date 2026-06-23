import { describe, expectTypeOf, it } from "vitest";

import type { ResourceKey, Sha256Hex } from "../types/ids.ts";
import type { ResourceCurrentState, ResourceRealDisplay } from "./resources.ts";
import type { BedrockState, StateError } from "./state.ts";

describe("BedrockState", () => {
	it("should expose readonly codegenHash, environment, pendingRebuild, realDisplay, resources, and version fields", () => {
		expectTypeOf<BedrockState>().toEqualTypeOf<{
			readonly codegenHash?: Sha256Hex;
			readonly environment: string;
			readonly pendingRebuild?: ReadonlySet<ResourceKey>;
			readonly realDisplay?: Readonly<Record<string, ResourceRealDisplay>>;
			readonly resources: ReadonlyArray<ResourceCurrentState>;
			readonly version: 1;
		}>();
	});

	it("should type codegenHash as an optional branded sha256 digest", () => {
		expectTypeOf<BedrockState["codegenHash"]>().toEqualTypeOf<Sha256Hex | undefined>();
	});

	it("should pin version to the literal 1, not number", () => {
		expectTypeOf<BedrockState["version"]>().toEqualTypeOf<1>();
	});

	it("should type pendingRebuild as an optional readonly set of resource keys", () => {
		expectTypeOf<BedrockState["pendingRebuild"]>().toEqualTypeOf<
			ReadonlySet<ResourceKey> | undefined
		>();
	});
});

describe("StateError", () => {
	it("should tag the error with the literal kind 'stateError'", () => {
		expectTypeOf<StateError["kind"]>().toEqualTypeOf<"stateError">();
	});

	it("should expose readonly file, kind, and reason fields", () => {
		expectTypeOf<StateError>().toEqualTypeOf<{
			readonly file: string;
			readonly kind: "stateError";
			readonly reason: string;
		}>();
	});
});
