import type { Result } from "@bedrock-rbx/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { BedrockState, StateError, StateRecord, StateVersion } from "../core/state.ts";
import type { StatePort } from "./state-port.ts";

describe("StatePort.read", () => {
	it("should accept an environment name as its single argument", () => {
		expectTypeOf<Parameters<StatePort["read"]>[0]>().toEqualTypeOf<string>();
	});

	it("should return Promise<Result<StateRecord, StateError>>", () => {
		expectTypeOf<ReturnType<StatePort["read"]>>().toEqualTypeOf<
			Promise<Result<StateRecord, StateError>>
		>();
	});
});

describe("StatePort.write", () => {
	it("should accept a BedrockState as its first argument", () => {
		expectTypeOf<Parameters<StatePort["write"]>[0]>().toEqualTypeOf<BedrockState>();
	});

	it("should accept an optional version to fence the write against", () => {
		expectTypeOf<Parameters<StatePort["write"]>[1]>().toEqualTypeOf<StateVersion | undefined>();
	});

	it("should return Promise<Result<void, StateError>>", () => {
		expectTypeOf<ReturnType<StatePort["write"]>>().toEqualTypeOf<
			Promise<Result<void, StateError>>
		>();
	});
});
