import type { Result } from "@bedrock-rbx/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { Config, ResolvedConfig } from "./schema.ts";
import {
	selectEnvironment,
	type SelectEnvironmentError,
	type UnknownEnvironmentError,
} from "./select-environment.ts";

describe("selectEnvironment signature", () => {
	it("should accept a Config and an environment name", () => {
		expectTypeOf(selectEnvironment).parameter(0).toEqualTypeOf<Config>();
		expectTypeOf(selectEnvironment).parameter(1).toEqualTypeOf<string>();
	});

	it("should return a Result of ResolvedConfig or SelectEnvironmentError so downstream functions consume the post-merge view", () => {
		expectTypeOf<ReturnType<typeof selectEnvironment>>().toEqualTypeOf<
			Result<ResolvedConfig, SelectEnvironmentError>
		>();
	});

	it("should discriminate SelectEnvironmentError across every resolution failure kind", () => {
		expectTypeOf<SelectEnvironmentError["kind"]>().toEqualTypeOf<
			| "incompletePassEntry"
			| "incompletePlaceEntry"
			| "incompleteUniverseEntry"
			| "unknownEnvironment"
		>();
	});
});

describe("UnknownEnvironmentError", () => {
	it("should expose the requested environment and the declared name list", () => {
		expectTypeOf<UnknownEnvironmentError["environment"]>().toEqualTypeOf<string>();
		expectTypeOf<UnknownEnvironmentError["declared"]>().toEqualTypeOf<ReadonlyArray<string>>();
	});
});
