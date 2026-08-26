import type { Result } from "@bedrock-rbx/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { StateLockError, StateLockHold, StateLockPort } from "./state-lock-port.ts";

describe("StateLockPort.acquire", () => {
	it("should accept an environment name as its single argument", () => {
		expectTypeOf<Parameters<StateLockPort["acquire"]>[0]>().toEqualTypeOf<string>();
	});

	it("should return Promise<Result<StateLockHold, StateLockError>>", () => {
		expectTypeOf<ReturnType<StateLockPort["acquire"]>>().toEqualTypeOf<
			Promise<Result<StateLockHold, StateLockError>>
		>();
	});
});

describe("StateLockHold.release", () => {
	it("should take no arguments", () => {
		expectTypeOf<Parameters<StateLockHold["release"]>>().toEqualTypeOf<[]>();
	});

	it("should return Promise<Result<void, StateLockError>>", () => {
		expectTypeOf<ReturnType<StateLockHold["release"]>>().toEqualTypeOf<
			Promise<Result<void, StateLockError>>
		>();
	});
});
