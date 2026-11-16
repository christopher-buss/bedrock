import { RequestAbortedError } from "@bedrock-rbx/ocale";

import { describe, it, vi } from "vitest";

import { BADGE_TRAP } from "#tests/helpers/drivers";
import { gamePassCurrent, gamePassDesired } from "#tests/helpers/resources";
import type { Operation } from "../core/operations.ts";
import type { BedrockState } from "../core/state.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import { INTERRUPT_GRACE_MS } from "./interrupt.ts";
import { applyAndPersistAsync } from "./reconcile-pass.ts";

const trap = {
	async create(): Promise<never> {
		throw new Error("Unexpected create");
	},
	async retire(): Promise<never> {
		throw new Error("Unexpected retire");
	},
};

const fast = gamePassCurrent({ key: asResourceKey("fast-pass"), name: "Fast" });
const slow = gamePassCurrent({ key: asResourceKey("slow-pass"), name: "Slow" });

function createOp(key: ResourceKey): Operation {
	return { key, desired: gamePassDesired({ key }), type: "create" };
}

/**
 * A game pass Driver: `fast-pass` resolves at once, `slow-pass` waits for its
 * request signal to abort, or for `slowDone`.
 * @param slowDone - Settles to let `slow-pass` finish.
 * @returns A Driver whose creates follow that timing.
 */
function gamePassDriver(slowDone: Promise<void>): ResourceDriver<"gamePass"> {
	return {
		async create(desired, context) {
			if (desired.key === fast.key) {
				return { data: fast, success: true };
			}

			const signal = context?.signal;
			const aborted = new Promise<"aborted">((resolve) => {
				signal?.addEventListener("abort", () => {
					resolve("aborted");
				});
			});
			const settled = await Promise.race([aborted, slowDone.then(() => "done" as const)]);
			return settled === "aborted"
				? { err: new RequestAbortedError("aborted"), success: false }
				: { data: slow, success: true };
		},
		retire: trap.retire,
	};
}

function registryOf(gamePass: ResourceDriver<"gamePass">): DriverRegistry {
	return { badge: BADGE_TRAP, developerProduct: trap, gamePass, place: trap, universe: trap };
}

function recordingStatePort(writes: Array<BedrockState>): StatePort {
	return {
		async read() {
			return { data: {}, success: true };
		},
		async write(state) {
			writes.push(state);
			return { data: undefined, success: true };
		},
	};
}

describe("applyAndPersistAsync on an Interrupt", () => {
	it("should abort a create still in flight after the grace period and write the creates that finished", async ({
		expect,
	}) => {
		expect.assertions(3);

		vi.useFakeTimers();
		const controller = new AbortController();
		const writes: Array<BedrockState> = [];
		const pending = applyAndPersistAsync({
			environment: "production",
			ops: [createOp(fast.key), createOp(slow.key)],
			priorResources: [],
			progress: { emit: () => {} },
			registry: registryOf(gamePassDriver(new Promise(() => {}))),
			signal: controller.signal,
			statePort: recordingStatePort(writes),
		});
		await vi.advanceTimersByTimeAsync(0);
		controller.abort();
		await vi.advanceTimersByTimeAsync(INTERRUPT_GRACE_MS - 1);

		expect(writes).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(1);
		const pass = await pending;
		vi.useRealTimers();

		expect(writes[0]!.resources).toStrictEqual([fast]);
		expect(pass.written.success).toBeTrue();
	});

	it("should keep a create that finishes within the grace period", async ({ expect }) => {
		expect.assertions(1);

		vi.useFakeTimers();
		const controller = new AbortController();
		const release = Promise.withResolvers<void>();
		const writes: Array<BedrockState> = [];
		const pending = applyAndPersistAsync({
			environment: "production",
			ops: [createOp(slow.key)],
			priorResources: [],
			progress: { emit: () => {} },
			registry: registryOf(gamePassDriver(release.promise)),
			signal: controller.signal,
			statePort: recordingStatePort(writes),
		});
		await vi.advanceTimersByTimeAsync(0);
		controller.abort();
		await vi.advanceTimersByTimeAsync(1000);
		release.resolve();
		await pending;
		vi.useRealTimers();

		expect(writes[0]!.resources).toStrictEqual([slow]);
	});

	it("should end the grace period at once on a second signal and still write State", async ({
		expect,
	}) => {
		expect.assertions(2);

		const controller = new AbortController();
		const graceEnd = new AbortController();
		const writes: Array<BedrockState> = [];
		const pending = applyAndPersistAsync({
			environment: "production",
			interruptGraceEnd: graceEnd.signal,
			ops: [createOp(fast.key), createOp(slow.key)],
			priorResources: [],
			progress: { emit: () => {} },
			registry: registryOf(gamePassDriver(new Promise(() => {}))),
			signal: controller.signal,
			statePort: recordingStatePort(writes),
		});
		await Promise.resolve();
		controller.abort();
		graceEnd.abort();
		const pass = await pending;

		expect(writes[0]!.resources).toStrictEqual([fast]);
		expect(pass.applied.success).toBeFalse();
	});

	it("should start no Operation after the signal aborts and report each one as interrupted", async ({
		expect,
	}) => {
		expect.assertions(2);

		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const writes: Array<BedrockState> = [];
		const pass = await applyAndPersistAsync({
			environment: "production",
			ops: [createOp(fast.key)],
			priorResources: [],
			progress: { emit: () => {} },
			registry: registryOf({ create, retire: trap.retire }),
			signal: AbortSignal.abort(),
			statePort: recordingStatePort(writes),
		});

		expect(create).not.toHaveBeenCalled();
		expect(pass.applied).toStrictEqual({
			err: { applied: [], failures: [{ key: fast.key, kind: "interrupted" }] },
			success: false,
		});
	});

	it("should stop the grace timer when the apply throws", async ({ expect, onTestFinished }) => {
		expect.assertions(2);

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const pending = applyAndPersistAsync({
			environment: "production",
			ops: [createOp(fast.key)],
			priorResources: [],
			progress: {
				emit: () => {
					throw new Error("progress failed");
				},
			},
			registry: registryOf(gamePassDriver(new Promise(() => {}))),
			signal: AbortSignal.abort(),
			statePort: recordingStatePort([]),
		});

		await expect(pending).rejects.toThrow("progress failed");
		expect(vi.getTimerCount()).toBe(0);
	});
});
