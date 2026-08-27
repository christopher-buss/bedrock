import type { Result } from "@bedrock-rbx/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type {
	StateLockAcquireOptions,
	StateLockError,
	StateLockHold,
	StateLockPort,
	StateLockWaiting,
} from "./state-lock-port.ts";

describe("StateLockPort.acquire", () => {
	it("should accept an environment name as its first argument", () => {
		expectTypeOf<Parameters<StateLockPort["acquire"]>[0]>().toEqualTypeOf<string>();
	});

	it("should accept the acquire options as an optional second argument", () => {
		expectTypeOf<Parameters<StateLockPort["acquire"]>[1]>().toEqualTypeOf<
			StateLockAcquireOptions | undefined
		>();
	});

	it("should report a wait through onWaiting without requiring a holder", () => {
		expectTypeOf<StateLockAcquireOptions["onWaiting"]>().toEqualTypeOf<
			((waiting: StateLockWaiting) => void) | undefined
		>();
		expectTypeOf<StateLockWaiting["holder"]>().toEqualTypeOf<string | undefined>();
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
