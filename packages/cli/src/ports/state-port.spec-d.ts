import type { Result } from "@bedrock/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { BedrockState, StateError } from "../core/state.ts";
import type { StatePort } from "./state-port.ts";

describe("StatePort.read", () => {
	it("should accept an environment name as its single argument", () => {
		expectTypeOf<Parameters<StatePort["read"]>[0]>().toEqualTypeOf<string>();
	});

	it("should return Promise<Result<BedrockState | null, StateError>>", () => {
		expectTypeOf<ReturnType<StatePort["read"]>>().toEqualTypeOf<
			Promise<Result<BedrockState | null, StateError>>
		>();
	});
});

describe("StatePort.write", () => {
	it("should accept a BedrockState as its single argument", () => {
		expectTypeOf<Parameters<StatePort["write"]>[0]>().toEqualTypeOf<BedrockState>();
	});

	it("should return Promise<Result<void, StateError>>", () => {
		expectTypeOf<ReturnType<StatePort["write"]>>().toEqualTypeOf<
			Promise<Result<void, StateError>>
		>();
	});
});
