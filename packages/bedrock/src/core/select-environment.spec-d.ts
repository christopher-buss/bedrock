import type { Result } from "@bedrock/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { Config, StateConfig } from "./schema.ts";
import {
	type EffectiveConfig,
	selectEnvironment,
	type SelectEnvironmentError,
	type UnknownEnvironmentError,
} from "./select-environment.ts";

describe("selectEnvironment signature", () => {
	it("should accept a Config and an environment name", () => {
		expectTypeOf(selectEnvironment).parameter(0).toEqualTypeOf<Config>();
		expectTypeOf(selectEnvironment).parameter(1).toEqualTypeOf<string>();
	});

	it("should return a Result of EffectiveConfig or SelectEnvError", () => {
		expectTypeOf<ReturnType<typeof selectEnvironment>>().toEqualTypeOf<
			Result<EffectiveConfig, SelectEnvironmentError>
		>();
	});

	it("should discriminate SelectEnvError on the unknownEnvironment and stateNotConfigured kinds", () => {
		expectTypeOf<SelectEnvironmentError["kind"]>().toEqualTypeOf<
			"stateNotConfigured" | "unknownEnvironment"
		>();
	});
});

describe("UnknownEnvironmentError", () => {
	it("should expose the requested environment and the declared name list", () => {
		expectTypeOf<UnknownEnvironmentError["environment"]>().toEqualTypeOf<string>();
		expectTypeOf<UnknownEnvironmentError["declared"]>().toEqualTypeOf<ReadonlyArray<string>>();
	});
});

describe("EffectiveConfig", () => {
	it("should make state non-optional after the resolver projects an environment", () => {
		expectTypeOf<EffectiveConfig["state"]>().toEqualTypeOf<StateConfig>();
	});

	it("should strip environments from the projected output", () => {
		expectTypeOf<EffectiveConfig>().not.toHaveProperty("environments");
	});

	it("should strip extends from the projected output", () => {
		expectTypeOf<EffectiveConfig>().not.toHaveProperty("extends");
	});
});
