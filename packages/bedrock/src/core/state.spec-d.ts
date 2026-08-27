import { describe, expectTypeOf, it } from "vitest";

import type { ResourceKey, Sha256Hex } from "../types/ids.ts";
import type { ResourceCurrentState, ResourceRealDisplay } from "./resources.ts";
import type {
	BedrockState,
	StateError,
	StateErrorBase,
	StateRecord,
	StateVersion,
} from "./state.ts";

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
	it("should discriminate the backend-neutral conditions alongside the original arm", () => {
		expectTypeOf<StateError["kind"]>().toEqualTypeOf<
			| "pluginStateBackend"
			| "stateAccessDenied"
			| "stateConflict"
			| "stateError"
			| "stateNotFound"
		>();
	});

	it("should carry readonly file and reason on every arm", () => {
		expectTypeOf<StateError>().toExtend<StateErrorBase>();
		expectTypeOf<StateError["file"]>().toEqualTypeOf<string>();
		expectTypeOf<StateError["reason"]>().toEqualTypeOf<string>();
	});

	it("should keep the original arm carrying nothing beyond file, kind, and reason", () => {
		expectTypeOf<keyof Extract<StateError, { kind: "stateError" }>>().toEqualTypeOf<
			"file" | "kind" | "reason"
		>();
	});

	it("should name the plugin and keep its payload opaque on the plugin arm", () => {
		expectTypeOf<
			Extract<StateError, { kind: "pluginStateBackend" }>["specifier"]
		>().toEqualTypeOf<string>();
		expectTypeOf<Extract<StateError, { kind: "pluginStateBackend" }>["detail"]>().toBeUnknown();
	});
});

describe("StateVersion", () => {
	it("should discriminate a record that existed from one that did not", () => {
		expectTypeOf<StateVersion["kind"]>().toEqualTypeOf<"absent" | "present">();
	});

	it("should carry the backend's own token only on the present arm", () => {
		expectTypeOf<Extract<StateVersion, { kind: "present" }>["token"]>().toEqualTypeOf<string>();
		expectTypeOf<keyof Extract<StateVersion, { kind: "absent" }>>().toEqualTypeOf<"kind">();
	});
});

describe("StateRecord", () => {
	it("should pair a present version with the state that record held", () => {
		expectTypeOf<{
			readonly state: BedrockState;
			readonly version: { readonly kind: "present"; readonly token: string };
		}>().toExtend<StateRecord>();
	});

	it("should pair an absent version with no state", () => {
		expectTypeOf<{ readonly version: { readonly kind: "absent" } }>().toExtend<StateRecord>();
	});

	it("should let a backend that cannot fence carry state with no version", () => {
		expectTypeOf<{ readonly state: BedrockState }>().toExtend<StateRecord>();
		expectTypeOf<Record<never, never>>().toExtend<StateRecord>();
	});

	it("should reject state read from a record the version says was absent", () => {
		expectTypeOf<{
			readonly state: BedrockState;
			readonly version: { readonly kind: "absent" };
		}>().not.toExtend<StateRecord>();
	});

	it("should reject a present version naming a record that carried no state", () => {
		expectTypeOf<{
			readonly version: { readonly kind: "present"; readonly token: string };
		}>().not.toExtend<StateRecord>();
	});
});
